import { cancelOrder, getOrder, listCustomerOrders } from '../../app/src/tools/definitions';
import { checkSchema, parseCancelOrder, parseGetOrder, parseListCustomerOrders, ToolInputError } from '../../app/src/tools/validate';

describe('checkSchema', () => {
  it('accepts input that fits', () => {
    expect(checkSchema(getOrder.inputSchema, { orderId: 'ord-1' })).toEqual([]);
  });

  it('reports a missing required field', () => {
    expect(checkSchema(getOrder.inputSchema, {})).toEqual(['input.orderId is required']);
  });

  it('refuses unknown fields, so a model can not smuggle extra arguments in', () => {
    expect(checkSchema(getOrder.inputSchema, { orderId: 'ord-1', status: 'CANCELLED' })).toEqual(['input.status is not allowed']);
  });

  it('checks types, and tells integer from number', () => {
    expect(checkSchema(listCustomerOrders.inputSchema, { customerId: 'cus-1', limit: 2.5 })).toEqual(['input.limit must be integer']);
    expect(checkSchema(getOrder.inputSchema, { orderId: 7 })).toEqual(['input.orderId must be string']);
    expect(checkSchema(getOrder.inputSchema, null)).toEqual(['input must be object']);
    expect(checkSchema(getOrder.inputSchema, [])).toEqual(['input must be object']);
  });

  it('checks array items', () => {
    const schema = { type: 'array' as const, items: { type: 'string' as const } };
    expect(checkSchema(schema, ['a', 1])).toEqual(['input[1] must be string']);
  });
});

describe('tool input rules the gateway schema can not express', () => {
  it('requires the order ID format', () => {
    expect(() => parseGetOrder(getOrder, { orderId: '../../etc' })).toThrow(ToolInputError);
    expect(parseGetOrder(getOrder, { orderId: 'ord-1001' })).toEqual({ orderId: 'ord-1001' });
  });

  it('defaults and bounds the list limit', () => {
    expect(parseListCustomerOrders(listCustomerOrders, { customerId: 'cus-42' })).toEqual({ customerId: 'cus-42', limit: 10 });
    expect(() => parseListCustomerOrders(listCustomerOrders, { customerId: 'cus-42', limit: 0 })).toThrow('between 1 and 20');
    expect(() => parseListCustomerOrders(listCustomerOrders, { customerId: 'cus-42', limit: 21 })).toThrow('between 1 and 20');
  });

  it('needs a real cancel reason', () => {
    expect(() => parseCancelOrder(cancelOrder, { orderId: 'ord-1', reason: '  x ' })).toThrow('3 to 200');
    expect(() => parseCancelOrder(cancelOrder, { orderId: 'ord-1', reason: 'x'.repeat(201) })).toThrow('3 to 200');
    expect(parseCancelOrder(cancelOrder, { orderId: 'ord-1', reason: ' customer asked ' })).toEqual({ orderId: 'ord-1', reason: 'customer asked' });
  });
});
