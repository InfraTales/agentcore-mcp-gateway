/**
 * Input validation for tool arguments.
 *
 * Two layers. `checkSchema` enforces the tool's input schema (types, required
 * fields, no unknown fields). The parse functions add the rules the gateway's
 * schema subset can't express: ID formats, length limits, number ranges.
 *
 * The handlers validate every call themselves. A Lambda function can be invoked
 * by anything its resource policy and IAM allow, so it should not assume the
 * caller already checked the input.
 */
import type { SchemaDefinition, ToolDefinition } from './definitions';

export class ToolInputError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid input: ${problems.join('; ')}`);
    this.name = 'ToolInputError';
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matches(schema: SchemaDefinition, value: unknown): boolean {
  const actual = typeOf(value);
  if (schema.type === 'number') return actual === 'number' || actual === 'integer';
  return actual === schema.type;
}

/** Returns a list of problems. An empty list means the value fits the schema. */
export function checkSchema(schema: SchemaDefinition, value: unknown, path = 'input'): string[] {
  if (!matches(schema, value)) return [`${path} must be ${schema.type}`];
  const problems: string[] = [];
  if (schema.type === 'object') {
    const obj = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) problems.push(`${path}.${key} is required`);
    }
    for (const [key, v] of Object.entries(obj)) {
      const child = props[key];
      if (!child) {
        problems.push(`${path}.${key} is not allowed`);
        continue;
      }
      if (v !== undefined) problems.push(...checkSchema(child, v, `${path}.${key}`));
    }
  }
  if (schema.type === 'array' && schema.items) {
    (value as unknown[]).forEach((item, i) => problems.push(...checkSchema(schema.items!, item, `${path}[${i}]`)));
  }
  return problems;
}

const ORDER_ID = /^ord-[0-9]{1,12}$/;
const CUSTOMER_ID = /^cus-[0-9]{1,12}$/;

function assertSchema(tool: ToolDefinition, input: unknown): Record<string, unknown> {
  const problems = checkSchema(tool.inputSchema, input);
  if (problems.length > 0) throw new ToolInputError(problems);
  return input as Record<string, unknown>;
}

export function parseGetOrder(tool: ToolDefinition, input: unknown): { orderId: string } {
  const { orderId } = assertSchema(tool, input) as { orderId: string };
  if (!ORDER_ID.test(orderId)) throw new ToolInputError(['input.orderId must look like ord-1001']);
  return { orderId };
}

export function parseListCustomerOrders(tool: ToolDefinition, input: unknown): { customerId: string; limit: number } {
  const { customerId, limit = 10 } = assertSchema(tool, input) as { customerId: string; limit?: number };
  const problems: string[] = [];
  if (!CUSTOMER_ID.test(customerId)) problems.push('input.customerId must look like cus-42');
  if (limit < 1 || limit > 20) problems.push('input.limit must be between 1 and 20');
  if (problems.length > 0) throw new ToolInputError(problems);
  return { customerId, limit };
}

export function parseCancelOrder(tool: ToolDefinition, input: unknown): { orderId: string; reason: string } {
  const { orderId, reason } = assertSchema(tool, input) as { orderId: string; reason: string };
  const problems: string[] = [];
  if (!ORDER_ID.test(orderId)) problems.push('input.orderId must look like ord-1001');
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 200) problems.push('input.reason must be 3 to 200 characters');
  if (problems.length > 0) throw new ToolInputError(problems);
  return { orderId, reason: trimmed };
}
