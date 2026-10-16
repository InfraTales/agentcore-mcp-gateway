/**
 * Runs the local MCP server against DynamoDB (or DynamoDB Local):
 *
 *   ORDERS_TABLE=orders AWS_ENDPOINT_URL_DYNAMODB=http://localhost:8020 npm run mcp:local
 *
 * Point MCP Inspector or any MCP client at http://127.0.0.1:3333/mcp.
 */
import { OrderStore } from '../orders/store';
import { startHttpServer } from './mcp-server';

const port = Number(process.env.PORT ?? 3333);
void startHttpServer(OrderStore.fromEnv(), port).then(() => console.log(`MCP server on http://127.0.0.1:${port}/mcp`));
