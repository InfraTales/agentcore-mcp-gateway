/**
 * The tool contract, written once.
 *
 * The CDK stack puts these definitions into each gateway target's inline tool
 * schema, and the local MCP server lists the same objects. A test checks that
 * both sides stay identical, so the contract an agent sees in AWS is the one we
 * test on a laptop.
 *
 * AgentCore Gateway accepts a small subset of JSON Schema for Lambda tools:
 * type, description, properties, required and items. Keywords such as enum,
 * pattern or maxLength are not part of that subset, so the handlers check those
 * rules themselves (see validate.ts).
 */

export type SchemaType = 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';

export interface SchemaDefinition {
  readonly type: SchemaType;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, SchemaDefinition>>;
  readonly required?: readonly string[];
  readonly items?: SchemaDefinition;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: SchemaDefinition & { readonly type: 'object' };
}

/** Gateway target names. The gateway shows tools to agents as `<target>___<tool>`. */
export const READ_TARGET = 'orders-read';
export const ADMIN_TARGET = 'orders-admin';

/** Separator between target name and tool name in the names the gateway exposes. */
export const TOOL_NAME_DELIMITER = '___';

export const getOrder: ToolDefinition = {
  name: 'get_order',
  description: 'Look up one order by its ID. Returns the status, total and items.',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order ID, for example ord-1001' },
    },
    required: ['orderId'],
  },
};

export const listCustomerOrders: ToolDefinition = {
  name: 'list_customer_orders',
  description: 'List the most recent orders for one customer, newest first.',
  inputSchema: {
    type: 'object',
    properties: {
      customerId: { type: 'string', description: 'Customer ID, for example cus-42' },
      limit: { type: 'integer', description: 'How many orders to return, 1 to 20. Default 10.' },
    },
    required: ['customerId'],
  },
};

export const cancelOrder: ToolDefinition = {
  name: 'cancel_order',
  description:
    'Cancel an open order. This cannot be undone. Only open orders can be cancelled; shipped orders are refused.',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string', description: 'Order ID, for example ord-1001' },
      reason: { type: 'string', description: 'Why the order is being cancelled, 3 to 200 characters' },
    },
    required: ['orderId', 'reason'],
  },
};

/** Tools served by the read-only Lambda function. */
export const READ_TOOLS: readonly ToolDefinition[] = [getOrder, listCustomerOrders];

/** Tools served by the admin Lambda function. cancel_order is the destructive one. */
export const ADMIN_TOOLS: readonly ToolDefinition[] = [cancelOrder];

/** The name an agent sees through the gateway, for example `orders-admin___cancel_order`. */
export function gatewayToolName(target: string, tool: string): string {
  return `${target}${TOOL_NAME_DELIMITER}${tool}`;
}
