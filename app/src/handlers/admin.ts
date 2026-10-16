/** Lambda function behind the `orders-admin` target: cancel_order. */
import { OrderStore } from '../orders/store';
import { runCancelOrder } from '../orders/tools';
import { lazyStore, makeHandler, type ToolFn } from './dispatch';

export const adminTools: Readonly<Record<string, ToolFn>> = { cancel_order: runCancelOrder };

export const handler = makeHandler(adminTools, lazyStore(() => OrderStore.fromEnv()));
