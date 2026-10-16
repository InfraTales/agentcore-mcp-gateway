/**
 * The real condition expressions, run by DynamoDB Local. Asserting the
 * expression string in a unit test proves nothing about what DynamoDB does.
 */
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { OrderStore } from '../../app/src/orders/store';
import { SEED } from '../support/fake-orders';
import { createTable } from '../support/local-table';

let store: OrderStore;
let drop: () => Promise<void>;
let read: (id: string) => Promise<Record<string, unknown> | undefined>;

beforeEach(async () => {
  const t = await createTable(SEED);
  store = t.store;
  drop = t.drop;
  read = async (orderId) => (await t.doc.send(new GetCommand({ TableName: t.tableName, Key: { orderId } }))).Item;
});
afterEach(() => drop());

test('get returns a stored order and undefined for a missing one', async () => {
  expect(await store.get('ord-1001')).toMatchObject({ customerId: 'cus-42', status: 'OPEN' });
  expect(await store.get('ord-404')).toBeUndefined();
});

test('listForCustomer reads the index newest first', async () => {
  expect((await store.listForCustomer('cus-42', 10)).map((o) => o.orderId)).toEqual(['ord-1002', 'ord-1001']);
  expect((await store.listForCustomer('cus-42', 1)).map((o) => o.orderId)).toEqual(['ord-1002']);
  expect(await store.listForCustomer('cus-0', 10)).toEqual([]);
});

test('cancel changes an OPEN order and records the reason', async () => {
  const result = await store.cancel('ord-1001', 'customer asked', new Date('2026-10-16T09:00:00Z'));
  expect(result).toMatchObject({ outcome: 'cancelled', order: { status: 'CANCELLED', cancelReason: 'customer asked' } });
  expect(await read('ord-1001')).toMatchObject({ status: 'CANCELLED', cancelledAt: '2026-10-16T09:00:00.000Z' });
});

test('cancel leaves a SHIPPED order untouched', async () => {
  expect(await store.cancel('ord-1002', 'too late')).toEqual({ outcome: 'not_cancellable', status: 'SHIPPED' });
  expect(await read('ord-1002')).toMatchObject({ status: 'SHIPPED' });
  expect(await read('ord-1002')).not.toHaveProperty('cancelReason');
});

test('cancel does not create an order that never existed', async () => {
  expect(await store.cancel('ord-404', 'typo')).toEqual({ outcome: 'not_found' });
  expect(await read('ord-404')).toBeUndefined();
});

test('a second cancel reports already_cancelled and keeps the first reason', async () => {
  await store.cancel('ord-1001', 'first reason');
  expect(await store.cancel('ord-1001', 'second reason')).toMatchObject({ outcome: 'already_cancelled', order: { cancelReason: 'first reason' } });
  expect(await read('ord-1001')).toMatchObject({ cancelReason: 'first reason' });
});

test('ten agents cancelling the same order at once: exactly one wins', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.cancel('ord-1003', `agent ${i}`)));
  const outcomes = results.map((r) => r.outcome);
  expect(outcomes.filter((o) => o === 'cancelled')).toHaveLength(1);
  expect(outcomes.filter((o) => o === 'already_cancelled')).toHaveLength(9);
  const winner = results.find((r) => r.outcome === 'cancelled') as { order: { cancelReason: string } };
  expect(await read('ord-1003')).toMatchObject({ cancelReason: winner.order.cancelReason });
});
