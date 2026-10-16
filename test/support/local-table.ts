/**
 * Creates a fresh orders table in DynamoDB Local with the same key schema and
 * index as the CDK stack. The SDK reaches DynamoDB Local through the standard
 * AWS_ENDPOINT_URL_DYNAMODB variable, the same way the app does.
 */
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CUSTOMER_INDEX, OrderStore, type Order } from '../../app/src/orders/store';

export function requireLocalEndpoint(): string {
  const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB;
  if (!endpoint || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(endpoint)) {
    throw new Error('Set AWS_ENDPOINT_URL_DYNAMODB to DynamoDB Local, for example http://localhost:8020');
  }
  // DynamoDB Local accepts any credentials; set dummies so the SDK never looks for real ones.
  process.env.AWS_ACCESS_KEY_ID ??= 'local';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'local';
  process.env.AWS_REGION ??= 'us-east-1';
  return endpoint;
}

export async function createTable(seed: Order[]): Promise<{ store: OrderStore; doc: DynamoDBDocumentClient; tableName: string; drop: () => Promise<void> }> {
  requireLocalEndpoint();
  const client = new DynamoDBClient({});
  const doc = DynamoDBDocumentClient.from(client);
  const tableName = `orders-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'orderId', AttributeType: 'S' },
        { AttributeName: 'customerId', AttributeType: 'S' },
        { AttributeName: 'createdAt', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'orderId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: CUSTOMER_INDEX,
          KeySchema: [
            { AttributeName: 'customerId', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  if (seed.length > 0) {
    await doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: seed.map((Item) => ({ PutRequest: { Item } })) } }));
  }
  return {
    store: new OrderStore(doc, tableName),
    doc,
    tableName,
    drop: async () => {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
      client.destroy();
    },
  };
}
