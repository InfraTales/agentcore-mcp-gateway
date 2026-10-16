/**
 * Each function ships as one self-contained index.js. Check nothing is left to
 * install, and that the real bundle loads and answers a gateway-shaped call.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { BUILD_DIR } from '../../infra/lib/orders-mcp-stack';

const FUNCTIONS = ['reader', 'admin'];

test.each(FUNCTIONS)('%s: index.js sits at the package root with only its source map', (name) => {
  expect(fs.readdirSync(path.join(BUILD_DIR, name)).sort()).toEqual(['index.js', 'index.js.map']);
});

test.each(FUNCTIONS)('%s: the bundle imports nothing outside Node.js itself', (name) => {
  // esbuild's metafile lists every import it left unbundled. Only Node built-ins may remain.
  const meta = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, `${name}.meta.json`), 'utf8')) as {
    outputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
  };
  const builtins = new Set(builtinModules);
  const external = Object.values(meta.outputs)
    .flatMap((o) => o.imports)
    .filter((i) => i.external)
    .map((i) => i.path.replace(/^node:/, ''))
    .filter((p) => !builtins.has(p));
  expect([...new Set(external)]).toEqual([]);
});

test.each(FUNCTIONS)('%s: the bundle loads in a clean Node.js process and rejects a non-gateway call', (name) => {
  // A separate process with no node_modules on its path, like the Lambda runtime.
  const script = `
    const { handler } = require(${JSON.stringify(path.join(BUILD_DIR, name, 'index.js'))});
    handler({}, { awsRequestId: 'x' }).then((r) => process.stdout.write(JSON.stringify(r)));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(BUILD_DIR, name),
    env: { PATH: process.env.PATH, ORDERS_TABLE: 'unused', AWS_REGION: 'us-east-1', NODE_PATH: '' },
    timeout: 20_000,
  }).toString();
  expect(JSON.parse(out)).toEqual({ error: { code: 'NOT_A_GATEWAY_CALL', message: 'expected an AgentCore Gateway tool call' } });
});
