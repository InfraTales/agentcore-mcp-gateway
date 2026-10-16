/**
 * The tool contract, checked with the official MCP TypeScript SDK client over
 * Streamable HTTP against the local server. The server is built from the same
 * definitions and handlers that AgentCore Gateway uses, so a drift in a tool
 * name, a schema or a handler shows up here before it reaches an agent.
 */
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../../app/src/local/mcp-server';
import { ADMIN_TARGET, ADMIN_TOOLS, gatewayToolName, READ_TARGET, READ_TOOLS } from '../../app/src/tools/definitions';
import { FakeOrders, SEED } from '../support/fake-orders';

let http: HttpServer;
let client: Client;
let orders: FakeOrders;

beforeEach(async () => {
  orders = new FakeOrders(SEED);
  http = await startHttpServer(orders);
  const { port } = http.address() as AddressInfo;
  client = new Client({ name: 'contract-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
});

afterEach(async () => {
  await client.close();
  await new Promise((resolve) => http.close(resolve));
});

const text = (result: Awaited<ReturnType<Client['callTool']>>) => {
  const [first] = result.content as { type: string; text: string }[];
  expect(first?.type).toBe('text');
  return JSON.parse(first!.text) as Record<string, any>;
};

test('lists every tool with the gateway name and the deployed schema', async () => {
  const { tools } = await client.listTools();
  const expected = [
    ...READ_TOOLS.map((t) => ({ name: gatewayToolName(READ_TARGET, t.name), description: t.description, inputSchema: t.inputSchema })),
    ...ADMIN_TOOLS.map((t) => ({ name: gatewayToolName(ADMIN_TARGET, t.name), description: t.description, inputSchema: t.inputSchema })),
  ];
  expect(tools).toEqual(expected);
});

test('get_order returns the order as JSON text', async () => {
  const result = await client.callTool({ name: 'orders-read___get_order', arguments: { orderId: 'ord-1001' } });
  expect(result.isError).toBe(false);
  expect(text(result)).toMatchObject({ order: { orderId: 'ord-1001', status: 'OPEN' } });
});

test('list_customer_orders returns newest first and honours the limit', async () => {
  const result = await client.callTool({ name: 'orders-read___list_customer_orders', arguments: { customerId: 'cus-42', limit: 1 } });
  expect(text(result).orders.map((o: { orderId: string }) => o.orderId)).toEqual(['ord-1002']);
});

test('input outside the schema comes back as a tool error, not a crash', async () => {
  const result = await client.callTool({ name: 'orders-read___get_order', arguments: { orderId: 1001 } });
  expect(result.isError).toBe(true);
  expect(text(result)).toEqual({ error: { code: 'INVALID_INPUT', message: 'input.orderId must be string' } });
});

test('cancel_order cancels an open order once, and a retry is safe', async () => {
  const first = await client.callTool({ name: 'orders-admin___cancel_order', arguments: { orderId: 'ord-1001', reason: 'customer asked' } });
  expect(text(first)).toMatchObject({ cancelled: true, order: { status: 'CANCELLED' } });
  const again = await client.callTool({ name: 'orders-admin___cancel_order', arguments: { orderId: 'ord-1001', reason: 'customer asked' } });
  expect(text(again)).toMatchObject({ cancelled: true, alreadyCancelled: true });
});

test('cancel_order refuses a shipped order', async () => {
  const result = await client.callTool({ name: 'orders-admin___cancel_order', arguments: { orderId: 'ord-1002', reason: 'too late' } });
  expect(result.isError).toBe(true);
  expect(text(result).error.code).toBe('NOT_CANCELLABLE');
  expect(orders.orders.get('ord-1002')?.status).toBe('SHIPPED');
});

test('a tool name without its target prefix is unknown, as it is on the gateway', async () => {
  const result = await client.callTool({ name: 'get_order', arguments: { orderId: 'ord-1001' } });
  expect(result.isError).toBe(true);
});
