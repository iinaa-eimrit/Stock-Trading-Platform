import { describe, it, expect } from 'vitest';
import { updateOrderStatus } from './state-machine';
import { Order } from './types';

describe('Order State Machine', () => {
  const createOrder = (status: any = 'open'): Order => ({
    id: '1',
    clientOrderId: 'c1',
    userId: 'u1',
    market: 'ETH_USDC',
    side: 'buy',
    type: 'limit',
    priceTicks: 100,
    quantityLots: 10,
    filledLots: 0,
    status,
    sequenceNumber: 1n,
    createdAt: Date.now(),
  });

  it('allows open -> partially_filled', () => {
    const order = createOrder('open');
    updateOrderStatus(order, 'partially_filled', 5);
    expect(order.status).toBe('partially_filled');
    expect(order.filledLots).toBe(5);
  });

  it('allows open -> filled', () => {
    const order = createOrder('open');
    updateOrderStatus(order, 'filled', 10);
    expect(order.status).toBe('filled');
    expect(order.filledLots).toBe(10);
  });

  it('allows open -> cancelled', () => {
    const order = createOrder('open');
    updateOrderStatus(order, 'cancelled');
    expect(order.status).toBe('cancelled');
  });

  it('allows partially_filled -> partially_filled', () => {
    const order = createOrder('partially_filled');
    order.filledLots = 2;
    updateOrderStatus(order, 'partially_filled', 3);
    expect(order.status).toBe('partially_filled');
    expect(order.filledLots).toBe(5);
  });

  it('allows partially_filled -> filled', () => {
    const order = createOrder('partially_filled');
    order.filledLots = 5;
    updateOrderStatus(order, 'filled', 5);
    expect(order.status).toBe('filled');
    expect(order.filledLots).toBe(10);
  });

  it('allows partially_filled -> cancelled', () => {
    const order = createOrder('partially_filled');
    updateOrderStatus(order, 'cancelled');
    expect(order.status).toBe('cancelled');
  });

  it('rejects filled -> open', () => {
    const order = createOrder('filled');
    expect(() => updateOrderStatus(order, 'open')).toThrow('Invalid state transition: filled -> open');
  });

  it('rejects filled -> partially_filled', () => {
    const order = createOrder('filled');
    expect(() => updateOrderStatus(order, 'partially_filled')).toThrow('Invalid state transition: filled -> partially_filled');
  });

  it('rejects filled -> cancelled', () => {
    const order = createOrder('filled');
    expect(() => updateOrderStatus(order, 'cancelled')).toThrow('Invalid state transition: filled -> cancelled');
  });

  it('rejects cancelled -> open', () => {
    const order = createOrder('cancelled');
    expect(() => updateOrderStatus(order, 'open')).toThrow('Invalid state transition: cancelled -> open');
  });

  it('rejects cancelled -> partially_filled', () => {
    const order = createOrder('cancelled');
    expect(() => updateOrderStatus(order, 'partially_filled')).toThrow('Invalid state transition: cancelled -> partially_filled');
  });

  it('rejects cancelled -> filled', () => {
    const order = createOrder('cancelled');
    expect(() => updateOrderStatus(order, 'filled')).toThrow('Invalid state transition: cancelled -> filled');
  });

  it('rejects filling beyond quantity', () => {
    const order = createOrder('open');
    expect(() => updateOrderStatus(order, 'filled', 15)).toThrow('Invalid fill: filledQuantity (15) exceeds quantity (10)');
  });
});
