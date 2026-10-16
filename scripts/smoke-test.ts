/**
 * Checks a deployed stack end to end: Cognito tokens, the gateway's JWT check,
 * AgentCore Policy, and the Lambda tools. Run `npm run seed` first.
 *
 * It proves the things only AWS can show:
 *  1. A request with no token is refused.
 *  2. The reader agent's tool list doesn't include cancel_order.
 *  3. The reader agent can't cancel, and the order stays OPEN.
 *  4. The ops agent can read and cancel.
 */
import { CognitoIdentityProviderClient, DescribeUserPoolClientCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { stackOutputs } from './stack-outputs';

const deadline = (ms: number) => AbortSignal.timeout(ms);

async function token(tokenUrl: string, userPoolId: string, clientId: string, scope: string): Promise<string> {
  const cognito = new CognitoIdentityProviderClient({});
  const { UserPoolClient } = await cognito.send(new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }));
  const basic = Buffer.from(`${clientId}:${UserPoolClient!.ClientSecret!}`).toString('base64');
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
    signal: deadline(15_000),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function connect(url: string, bearer: string): Promise<Client> {
  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
  return client;
}

function check(ok: boolean, what: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const out = await stackOutputs();
  const url = out.GatewayUrl!.endsWith('/mcp') ? out.GatewayUrl! : `${out.GatewayUrl!.replace(/\/$/, '')}/mcp`;

  const anonymous = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    signal: deadline(15_000),
  });
  check(anonymous.status === 401, `no token is refused (got ${anonymous.status})`);

  const readerToken = await token(out.TokenUrl!, out.UserPoolId!, out.ReaderClientId!, 'orders/read');
  const opsToken = await token(out.TokenUrl!, out.UserPoolId!, out.OpsClientId!, 'orders/read orders/admin');

  const reader = await connect(url, readerToken);
  const ops = await connect(url, opsToken);
  try {
    const readerTools = (await reader.listTools()).tools.map((t) => t.name);
    check(readerTools.includes('orders-read___get_order'), 'reader agent sees get_order');
    check(!readerTools.includes('orders-admin___cancel_order'), 'reader agent does not see cancel_order');

    const denied = await reader
      .callTool({ name: 'orders-admin___cancel_order', arguments: { orderId: 'ord-1003', reason: 'smoke test' } })
      .then((r) => r.isError === true)
      .catch(() => true);
    check(denied, 'reader agent cannot cancel');

    const after = await ops.callTool({ name: 'orders-read___get_order', arguments: { orderId: 'ord-1003' } });
    check(JSON.stringify(after.content).includes('OPEN'), 'the order is still OPEN after the refused cancel');

    const opsTools = (await ops.listTools()).tools.map((t) => t.name);
    check(opsTools.includes('orders-admin___cancel_order'), 'ops agent sees cancel_order');
    const cancelled = await ops.callTool({ name: 'orders-admin___cancel_order', arguments: { orderId: 'ord-1003', reason: 'smoke test' } });
    check(JSON.stringify(cancelled.content).includes('"cancelled":true'), 'ops agent can cancel');
  } finally {
    await reader.close();
    await ops.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
