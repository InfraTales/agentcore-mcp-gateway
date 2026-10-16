/** Lambda function behind the `orders-read` target: get_order, list_customer_orders. */
import { OrderStore } from '../orders/store';
import { runGetOrder, runListCustomerOrders } from '../orders/tools';
import { lazyStore, makeHandler, type ToolFn } from './dispatch';

export const readerTools: Readonly<Record<string, ToolFn>> = {
  get_order: runGetOrder,
  list_customer_orders: runListCustomerOrders,
};

export const handler = makeHandler(readerTools, lazyStore(() => OrderStore.fromEnv()));
