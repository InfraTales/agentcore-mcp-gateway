/**
 * Order storage in Amazon DynamoDB.
 *
 * Table: partition key `orderId`. Index `byCustomer`: partition key
 * `customerId`, sort key `createdAt` (ISO 8601 text, so it sorts by time).
 *
 * The SDK client honours AWS_ENDPOINT_URL_DYNAMODB, which is how the engine
 * tests point it at DynamoDB Local. There is no test-only code path here.
 */
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export type OrderStatus = 'OPEN' | 'SHIPPED' | 'CANCELLED';

export interface Order {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  totalCents: number;
  items: { sku: string; qty: number }[];
  createdAt: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export type CancelResult =
  | { outcome: 'cancelled'; order: Order }
  | { outcome: 'already_cancelled'; order: Order }
  | { outcome: 'not_cancellable'; status: OrderStatus }
  | { outcome: 'not_found' };

export const CUSTOMER_INDEX = 'byCustomer';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

/** What the tools need from storage. OrderStore is the DynamoDB version. */
export interface Orders {
  get(orderId: string): Promise<Order | undefined>;
  listForCustomer(customerId: string, limit: number): Promise<Order[]>;
  cancel(orderId: string, reason: string): Promise<CancelResult>;
}

export class OrderStore implements Orders {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  static fromEnv(): OrderStore {
    const client = new DynamoDBClient({});
    return new OrderStore(DynamoDBDocumentClient.from(client), requireEnv('ORDERS_TABLE'));
  }

  async get(orderId: string): Promise<Order | undefined> {
    const out = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { orderId } }));
    return out.Item as Order | undefined;
  }

  async listForCustomer(customerId: string, limit: number): Promise<Order[]> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: CUSTOMER_INDEX,
        KeyConditionExpression: 'customerId = :c',
        ExpressionAttributeValues: { ':c': customerId },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (out.Items ?? []) as Order[];
  }

  /**
   * Cancels an order only if it is still OPEN. The condition runs inside
   * DynamoDB, so two agents cancelling at once can't both succeed, and a shipped
   * order can't be cancelled by a stale read.
   *
   * UpdateItem creates the item when the key doesn't exist. `#s = :open` also
   * stops that: on a missing item there is no status, so the comparison is false.
   * We first had `attribute_exists(orderId) AND` in front of it; a mutation run
   * against DynamoDB Local showed that clause changed nothing, so it's gone.
   */
  async cancel(orderId: string, reason: string, now: Date = new Date()): Promise<CancelResult> {
    try {
      const out = await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { orderId },
          UpdateExpression: 'SET #s = :cancelled, cancelledAt = :now, cancelReason = :reason',
          ConditionExpression: '#s = :open',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: {
            ':cancelled': 'CANCELLED',
            ':open': 'OPEN',
            ':now': now.toISOString(),
            ':reason': reason,
          },
          ReturnValues: 'ALL_NEW',
          ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
        }),
      );
      return { outcome: 'cancelled', order: out.Attributes as Order };
    } catch (err) {
      if (!(err instanceof ConditionalCheckFailedException)) throw err;
      // DynamoDB returns the item as it was when the condition failed (raw
      // attribute map, even through the document client). No second read.
      const current = err.Item ? (unmarshall(err.Item) as Order) : undefined;
      if (!current) return { outcome: 'not_found' };
      if (current.status === 'CANCELLED') return { outcome: 'already_cancelled', order: current };
      return { outcome: 'not_cancellable', status: current.status };
    }
  }
}
