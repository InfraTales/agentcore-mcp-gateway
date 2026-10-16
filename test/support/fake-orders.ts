import type { CancelResult, Order, Orders } from '../../app/src/orders/store';

/** In-memory Orders for MCP contract tests. The engine tests use DynamoDB Local instead. */
export class FakeOrders implements Orders {
  readonly orders = new Map<string, Order>();

  constructor(seed: Order[] = []) {
    for (const o of seed) this.orders.set(o.orderId, structuredClone(o));
  }

  get(orderId: string): Promise<Order | undefined> {
    return Promise.resolve(this.orders.get(orderId));
  }

  listForCustomer(customerId: string, limit: number): Promise<Order[]> {
    const list = [...this.orders.values()]
      .filter((o) => o.customerId === customerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    return Promise.resolve(list);
  }

  cancel(orderId: string, reason: string): Promise<CancelResult> {
    const o = this.orders.get(orderId);
    if (!o) return Promise.resolve({ outcome: 'not_found' });
    if (o.status === 'CANCELLED') return Promise.resolve({ outcome: 'already_cancelled', order: o });
    if (o.status !== 'OPEN') return Promise.resolve({ outcome: 'not_cancellable', status: o.status });
    Object.assign(o, { status: 'CANCELLED', cancelReason: reason, cancelledAt: '2026-10-16T00:00:00.000Z' });
    return Promise.resolve({ outcome: 'cancelled', order: o });
  }
}

export const SEED: [Order, Order, Order] = [
  { orderId: 'ord-1001', customerId: 'cus-42', status: 'OPEN', totalCents: 4599, items: [{ sku: 'BOOK-1', qty: 1 }], createdAt: '2026-10-01T10:00:00.000Z' },
  { orderId: 'ord-1002', customerId: 'cus-42', status: 'SHIPPED', totalCents: 1299, items: [{ sku: 'PEN-3', qty: 3 }], createdAt: '2026-10-03T10:00:00.000Z' },
  { orderId: 'ord-1003', customerId: 'cus-7', status: 'OPEN', totalCents: 999, items: [{ sku: 'MUG-1', qty: 1 }], createdAt: '2026-10-02T10:00:00.000Z' },
];

/** The Lambda context the gateway sends, as the handlers read it. */
export function gatewayContext(fullToolName: string) {
  return {
    awsRequestId: 'test-request',
    clientContext: {
      custom: {
        bedrockAgentCoreMessageVersion: '1.0',
        bedrockAgentCoreToolName: fullToolName,
        bedrockAgentCoreGatewayId: 'gw-test',
        bedrockAgentCoreTargetId: 'tg-test',
        bedrockAgentCoreAwsRequestId: 'agc-req',
        bedrockAgentCoreMcpMessageId: '1',
      },
    } as never,
  };
}
