/**
 * The business logic behind each tool. No Lambda, no MCP: plain functions that
 * take checked input and an OrderStore. The Lambda handlers and the local MCP
 * server both call these, which is what lets the local server prove the contract.
 */
import { cancelOrder, getOrder, listCustomerOrders } from '../tools/definitions';
import { parseCancelOrder, parseGetOrder, parseListCustomerOrders, ToolInputError } from '../tools/validate';
import { toolError, type ToolError } from '../handlers/result';
import type { Order, Orders } from './store';

export type ToolOutput = Record<string, unknown> | ToolError;

function inputError(err: unknown): ToolError {
  if (err instanceof ToolInputError) return toolError('INVALID_INPUT', err.problems.join('; '));
  throw err;
}

function publicOrder(o: Order): Record<string, unknown> {
  return {
    orderId: o.orderId,
    customerId: o.customerId,
    status: o.status,
    totalCents: o.totalCents,
    items: o.items,
    createdAt: o.createdAt,
    ...(o.cancelledAt ? { cancelledAt: o.cancelledAt } : {}),
  };
}

export async function runGetOrder(store: Orders, input: unknown): Promise<ToolOutput> {
  let args;
  try {
    args = parseGetOrder(getOrder, input);
  } catch (err) {
    return inputError(err);
  }
  const order = await store.get(args.orderId);
  if (!order) return toolError('NOT_FOUND', `no order ${args.orderId}`);
  return { order: publicOrder(order) };
}

export async function runListCustomerOrders(store: Orders, input: unknown): Promise<ToolOutput> {
  let args;
  try {
    args = parseListCustomerOrders(listCustomerOrders, input);
  } catch (err) {
    return inputError(err);
  }
  const orders = await store.listForCustomer(args.customerId, args.limit);
  return { customerId: args.customerId, orders: orders.map(publicOrder) };
}

export async function runCancelOrder(store: Orders, input: unknown): Promise<ToolOutput> {
  let args;
  try {
    args = parseCancelOrder(cancelOrder, input);
  } catch (err) {
    return inputError(err);
  }
  const result = await store.cancel(args.orderId, args.reason);
  switch (result.outcome) {
    case 'cancelled':
      return { cancelled: true, order: publicOrder(result.order) };
    case 'already_cancelled':
      // Safe to retry: a second cancel of the same order reports success without changing it.
      return { cancelled: true, alreadyCancelled: true, order: publicOrder(result.order) };
    case 'not_cancellable':
      return toolError('NOT_CANCELLABLE', `order ${args.orderId} is ${result.status} and can't be cancelled`);
    case 'not_found':
      return toolError('NOT_FOUND', `no order ${args.orderId}`);
  }
}
