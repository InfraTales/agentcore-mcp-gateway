/** Puts three sample orders into the deployed table: `npm run seed`. */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { stackOutputs } from './stack-outputs';

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
export const SAMPLE_ORDERS = [
  { orderId: 'ord-1001', customerId: 'cus-42', status: 'OPEN', totalCents: 4599, items: [{ sku: 'BOOK-1', qty: 1 }], createdAt: iso(3) },
  { orderId: 'ord-1002', customerId: 'cus-42', status: 'SHIPPED', totalCents: 1299, items: [{ sku: 'PEN-3', qty: 3 }], createdAt: iso(1) },
  { orderId: 'ord-1003', customerId: 'cus-7', status: 'OPEN', totalCents: 999, items: [{ sku: 'MUG-1', qty: 1 }], createdAt: iso(2) },
];

async function main() {
  const { OrdersTable } = await stackOutputs();
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await doc.send(new BatchWriteCommand({ RequestItems: { [OrdersTable!]: SAMPLE_ORDERS.map((Item) => ({ PutRequest: { Item } })) } }));
  console.log(`seeded ${SAMPLE_ORDERS.length} orders into ${OrdersTable}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
