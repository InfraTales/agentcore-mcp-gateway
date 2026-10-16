#!/usr/bin/env node
/**
 * Breaks each safeguard once, runs the tests that should notice, and restores
 * the file. Every line should say CAUGHT. A SURVIVED line means a test is
 * missing or the safeguard does nothing.
 *
 *   docker run -d --rm -p 8020:8000 amazon/dynamodb-local:3.3.2
 *   AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8020 node scripts/mutation-check.mjs [filter]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const engine = ['jest', '-c', 'jest.engine.config.js'];
const unit = ['jest', 'test/unit', 'test/mcp'];
const infra = ['jest', 'test/infra'];

const MUTANTS = [
  ['cancel condition checks existence only', 'app/src/orders/store.ts', "ConditionExpression: '#s = :open'", "ConditionExpression: 'attribute_exists(orderId)'", engine],
  ['no ALL_OLD on condition failure', 'app/src/orders/store.ts', "ReturnValuesOnConditionCheckFailure: 'ALL_OLD',", '', engine],
  ['unknown input fields allowed', 'app/src/tools/validate.ts', 'problems.push(`${path}.${key} is not allowed`);', '', unit],
  ['tool lookup reaches Object.prototype', 'app/src/handlers/dispatch.ts', 'Object.hasOwn(tools, meta.toolName) ? tools[meta.toolName] : undefined', 'tools[meta.toolName]', unit],
  ['prefix stripped at the wrong place', 'app/src/handlers/gateway-context.ts', 'fullToolName.indexOf(TOOL_NAME_DELIMITER)', "fullToolName.lastIndexOf('_') - 2", unit],
  ['tool arguments logged', 'app/src/handlers/dispatch.ts', "msg: 'tool call',", "msg: 'tool call', args: event,", unit],
  ['cancel policy without scope check', 'infra/lib/policies.ts', ')\nwhen {\n  principal.hasTag("scope") &&\n  principal.getTag("scope") like "*${ADMIN_SCOPE}*"\n};`,', ');`,', infra],
  ['read policy permits every action', 'infra/lib/policies.ts', '  action in [\n    ${readActions}\n  ],', '  action,', infra],
  ['gateway returns DEBUG errors', 'infra/lib/orders-mcp-stack.ts', "protocolType: 'MCP',", "protocolType: 'MCP',\n      exceptionLevel: 'DEBUG',", infra],
  ['reader function can write', 'infra/lib/orders-mcp-stack.ts', "actions: ['dynamodb:GetItem', 'dynamodb:Query'],", "actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:UpdateItem'],", infra],
  ['deployed schema drifts from local', 'infra/lib/orders-mcp-stack.ts', 'toolSchema: toolSchema(tools)', "toolSchema: toolSchema(tools.map((t) => ({ ...t, description: t.description + '.' })))", infra],
  ['policy created before targets', 'infra/lib/orders-mcp-stack.ts', 'policy.addResourceDependency(readTarget);', '', infra],
  ['any Cognito client accepted', 'infra/lib/orders-mcp-stack.ts', 'allowedClients: [readerClient.userPoolClientId, opsClient.userPoolClientId],', '', infra],
];

const filter = process.argv[2];
let survived = 0;
for (const [name, file, from, to, cmd] of MUTANTS) {
  if (filter && !name.includes(filter)) continue;
  const original = readFileSync(file, 'utf8');
  if (original.split(from).length !== 2) throw new Error(`${name}: pattern must appear exactly once in ${file}`);
  writeFileSync(file, original.replace(from, to));
  try {
    const r = spawnSync('npx', cmd, { encoding: 'utf8', timeout: 300_000 });
    const tests = (r.stdout + r.stderr).split('\n').filter((l) => l.startsWith('Tests:')).pop() ?? 'no test summary';
    if (r.status === 0) survived++;
    console.log(`${r.status === 0 ? 'SURVIVED' : 'CAUGHT  '} | ${name} | ${tests}`);
  } finally {
    writeFileSync(file, original);
  }
}
process.exit(survived ? 1 : 0);
