import { gatewayMetadata } from '../../app/src/handlers/gateway-context';
import { gatewayContext } from '../support/fake-orders';

describe('gatewayMetadata', () => {
  it('strips the target prefix from the tool name', () => {
    const meta = gatewayMetadata(gatewayContext('orders-admin___cancel_order'));
    expect(meta).toMatchObject({ toolName: 'cancel_order', fullToolName: 'orders-admin___cancel_order', gatewayId: 'gw-test', targetId: 'tg-test' });
  });

  it('splits on the first delimiter only, so tool names may contain underscores', () => {
    expect(gatewayMetadata(gatewayContext('orders-read___list_customer_orders'))?.toolName).toBe('list_customer_orders');
  });

  it('also reads the capitalised Custom key', () => {
    const meta = gatewayMetadata({ clientContext: { Custom: { bedrockAgentCoreToolName: 't___x' } } as never });
    expect(meta?.toolName).toBe('x');
  });

  it('returns undefined for a direct invoke with no gateway context', () => {
    expect(gatewayMetadata({ clientContext: undefined })).toBeUndefined();
    expect(gatewayMetadata({ clientContext: { custom: {} } as never })).toBeUndefined();
  });
});
