/**
 * Flow tests through the real Lambda handlers, with the AWS SDK mocked.
 * DynamoDB Local runs the real condition expressions in test/engine.
 */
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { gatewayContext, SEED } from '../support/fake-orders';

process.env.ORDERS_TABLE = 'orders-test';
process.env.AWS_REGION = 'us-east-1';
const ddb = mockClient(DynamoDBDocumentClient);

// Imported after the env is set; the store is created on first call.
import { handler as admin } from '../../app/src/handlers/admin';
import { handler as reader } from '../../app/src/handlers/reader';

beforeEach(() => ddb.reset());
afterEach(() => jest.restoreAllMocks());

describe('reader function', () => {
  it('get_order returns the public order fields', async () => {
    ddb.on(GetCommand, { TableName: 'orders-test', Key: { orderId: 'ord-1001' } }).resolves({ Item: { ...SEED[0], internalNote: 'x' } });
    const out = await reader({ orderId: 'ord-1001' }, gatewayContext('orders-read___get_order'));
    expect(out).toEqual({ order: expect.objectContaining({ orderId: 'ord-1001', status: 'OPEN', totalCents: 4599 }) });
    expect(JSON.stringify(out)).not.toContain('internalNote');
  });

  it('get_order on a missing order is a NOT_FOUND result the agent can read', async () => {
    ddb.on(GetCommand).resolves({});
    expect(await reader({ orderId: 'ord-9' }, gatewayContext('orders-read___get_order'))).toEqual({
      error: { code: 'NOT_FOUND', message: 'no order ord-9' },
    });
  });

  it('bad input never reaches DynamoDB', async () => {
    const out = await reader({ orderId: 'ord-1', extra: true }, gatewayContext('orders-read___get_order'));
    expect(out).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect(ddb.calls()).toHaveLength(0);
  });

  it('list_customer_orders queries the customer index newest first with the limit', async () => {
    ddb.on(QueryCommand).resolves({ Items: [SEED[1], SEED[0]] });
    const out = await reader({ customerId: 'cus-42', limit: 2 }, gatewayContext('orders-read___list_customer_orders'));
    expect(out).toMatchObject({ customerId: 'cus-42', orders: [{ orderId: 'ord-1002' }, { orderId: 'ord-1001' }] });
    expect(ddb.commandCalls(QueryCommand)[0]!.args[0].input).toMatchObject({ IndexName: 'byCustomer', ScanIndexForward: false, Limit: 2 });
  });

  it('refuses a tool that belongs to the other function', async () => {
    expect(await reader({ orderId: 'ord-1', reason: 'abc' }, gatewayContext('orders-read___cancel_order'))).toMatchObject({
      error: { code: 'UNKNOWN_TOOL' },
    });
  });

  it('treats inherited object keys as unknown tools', async () => {
    expect(await reader({}, gatewayContext('orders-read___constructor'))).toMatchObject({ error: { code: 'UNKNOWN_TOOL' } });
    expect(await reader({}, gatewayContext('orders-read___toString'))).toMatchObject({ error: { code: 'UNKNOWN_TOOL' } });
  });

  it('logs the tool call without the arguments', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    ddb.on(GetCommand).resolves({});
    await reader({ orderId: 'ord-555' }, gatewayContext('orders-read___get_order'));
    const line = JSON.parse(log.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ msg: 'tool call', tool: 'orders-read___get_order', gatewayId: 'gw-test', ok: false, errorCode: 'NOT_FOUND' });
    expect(log.mock.calls[0]![0]).not.toContain('ord-555');
  });

  it('lets unexpected AWS errors throw, so Lambda records a failure', async () => {
    ddb.on(GetCommand).rejects(new Error('throttled'));
    await expect(reader({ orderId: 'ord-1' }, gatewayContext('orders-read___get_order'))).rejects.toThrow('throttled');
  });
});

describe('admin function', () => {
  const cancel = (input: unknown) => admin(input, gatewayContext('orders-admin___cancel_order'));
  const conditionFailed = (item?: object) =>
    new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {}, Item: item ? marshall(item) : undefined });

  it('cancels with a condition that the order is OPEN', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { ...SEED[0], status: 'CANCELLED', cancelledAt: '2026-10-16T00:00:00.000Z' } });
    expect(await cancel({ orderId: 'ord-1001', reason: 'customer asked' })).toMatchObject({ cancelled: true, order: { status: 'CANCELLED' } });
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toBe('#s = :open');
    expect(input.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':reason': 'customer asked', ':open': 'OPEN' });
  });

  it('reports a shipped order as NOT_CANCELLABLE', async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed(SEED[1]));
    expect(await cancel({ orderId: 'ord-1002', reason: 'customer asked' })).toEqual({
      error: { code: 'NOT_CANCELLABLE', message: "order ord-1002 is SHIPPED and can't be cancelled" },
    });
  });

  it('a repeat cancel reports success without writing again', async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed({ ...SEED[0], status: 'CANCELLED' }));
    expect(await cancel({ orderId: 'ord-1001', reason: 'retry' })).toMatchObject({ cancelled: true, alreadyCancelled: true });
  });

  it('a missing order is NOT_FOUND', async () => {
    ddb.on(UpdateCommand).rejects(conditionFailed());
    expect(await cancel({ orderId: 'ord-77', reason: 'customer asked' })).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('needs a reason', async () => {
    expect(await cancel({ orderId: 'ord-1001' })).toMatchObject({ error: { code: 'INVALID_INPUT', message: 'input.reason is required' } });
    expect(ddb.calls()).toHaveLength(0);
  });

  it('answers a direct invoke without gateway context with an error, not a cancel', async () => {
    expect(await admin({ orderId: 'ord-1001', reason: 'abc' }, { awsRequestId: 'x', clientContext: undefined })).toMatchObject({
      error: { code: 'NOT_A_GATEWAY_CALL' },
    });
    expect(ddb.calls()).toHaveLength(0);
  });
});
