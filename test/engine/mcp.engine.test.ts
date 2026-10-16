/**
 * The full local path: official MCP client -> Streamable HTTP -> local MCP
 * server -> the real Lambda handlers -> DynamoDB Local.
 */
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../../app/src/local/mcp-server';
import { SEED } from '../support/fake-orders';
import { createTable } from '../support/local-table';

let http: HttpServer;
let drop: () => Promise<void>;
let url: URL;

beforeEach(async () => {
  const t = await createTable(SEED);
  drop = t.drop;
  http = await startHttpServer(t.store);
  url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
});
afterEach(async () => {
  await new Promise((resolve) => http.close(resolve));
  await drop();
});

async function connect(): Promise<Client> {
  const client = new Client({ name: 'engine-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}
const body = (r: Awaited<ReturnType<Client['callTool']>>) => JSON.parse((r.content as { text: string }[])[0]!.text) as Record<string, any>;

test('an agent reads, cancels and reads again through MCP', async () => {
  const client = await connect();
  try {
    expect(body(await client.callTool({ name: 'orders-read___get_order', arguments: { orderId: 'ord-1001' } }))).toMatchObject({ order: { status: 'OPEN' } });
    expect(body(await client.callTool({ name: 'orders-admin___cancel_order', arguments: { orderId: 'ord-1001', reason: 'customer asked' } }))).toMatchObject({ cancelled: true });
    expect(body(await client.callTool({ name: 'orders-read___get_order', arguments: { orderId: 'ord-1001' } }))).toMatchObject({ order: { status: 'CANCELLED' } });
  } finally {
    await client.close();
  }
});

test('five MCP clients racing to cancel one order: one cancel, four safe retries', async () => {
  const clients = await Promise.all(Array.from({ length: 5 }, () => connect()));
  try {
    const results = await Promise.all(
      clients.map((c, i) => c.callTool({ name: 'orders-admin___cancel_order', arguments: { orderId: 'ord-1003', reason: `agent ${i}` } })),
    );
    const bodies = results.map(body);
    expect(bodies.filter((b) => b.cancelled === true && !b.alreadyCancelled)).toHaveLength(1);
    expect(bodies.filter((b) => b.alreadyCancelled === true)).toHaveLength(4);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
  }
});
