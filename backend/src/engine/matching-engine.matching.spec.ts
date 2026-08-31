import { placeOrder, cancelOrder } from './test-helpers';
import { describe, it, expect, beforeEach } from 'vitest';
import { MatchingEngine } from './matching-engine';
import { OrderSide, OrderType } from './types';

describe('MatchingEngine (Layer A - Matching Logic)', () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    engine = new MatchingEngine([{ symbol: 'ETH_USDC', baseAsset: 'ETH', quoteAsset: 'USDC', tickSize: 0.01, lotSize: 0.001, minNotional: 1 }]);
  });

  const place = (clientOrderId: string, side: OrderSide, orderType: OrderType, priceTicks: number, quantityLots: number, userId = 'u1') => {
    return placeOrder(engine, { userId, clientOrderId, market: 'ETH_USDC', side, orderType, priceTicks, quantityLots });
  };

  it('handles limit buy ↔ limit sell (full fill)', () => {
    place('a1', 'sell', 'limit', 100, 10);
    const res = place('b1', 'buy', 'limit', 100, 10, 'u2');

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].quantityLots).toBe(10);
    expect(res.order!.status).toBe('filled');
    
    const ask = engine.getOrders().get(res.trades[0].sellOrderId);
    expect(ask?.status).toBe('filled');
  });

  it('handles partial fill of maker (taker fully filled)', () => {
    place('a1', 'sell', 'limit', 100, 10);
    const res = place('b1', 'buy', 'limit', 100, 4, 'u2');

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].quantityLots).toBe(4);
    expect(res.order!.status).toBe('filled');

    const ask = engine.getOrders().get(res.trades[0].sellOrderId);
    expect(ask?.status).toBe('partially_filled');
    expect(ask?.filledLots).toBe(4);
  });

  it('handles partial fill of taker (maker fully filled)', () => {
    place('a1', 'sell', 'limit', 100, 4);
    const res = place('b1', 'buy', 'limit', 100, 10, 'u2');

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].quantityLots).toBe(4);
    expect(res.order!.status).toBe('partially_filled');
    expect(res.order!.filledLots).toBe(4);

    const ask = engine.getOrders().get(res.trades[0].sellOrderId);
    expect(ask?.status).toBe('filled');
  });

  it('handles market order sweeping multiple price levels', () => {
    place('a1', 'sell', 'limit', 100, 5, 'u1');
    place('a2', 'sell', 'limit', 101, 5, 'u2');
    place('a3', 'sell', 'limit', 102, 5, 'u3');

    const res = place('b1', 'buy', 'market', 0, 12, 'u4');

    expect(res.trades).toHaveLength(3);
    expect(res.trades[0].priceTicks).toBe(100);
    expect(res.trades[0].quantityLots).toBe(5);
    expect(res.trades[1].priceTicks).toBe(101);
    expect(res.trades[1].quantityLots).toBe(5);
    expect(res.trades[2].priceTicks).toBe(102);
    expect(res.trades[2].quantityLots).toBe(2);

    expect(res.order!.status).toBe('filled');
    expect(engine.getOrders().get(res.trades[2].sellOrderId)?.status).toBe('partially_filled');
  });

  it('handles market order with insufficient liquidity', () => {
    place('a1', 'sell', 'limit', 100, 5, 'u1');
    const res = place('b1', 'buy', 'market', 0, 10, 'u2');

    expect(res.trades).toHaveLength(1);
    expect(res.order!.status).toBe('partially_filled');
    expect(res.order!.filledLots).toBe(5);
  });

  it('handles IOC with no liquidity', () => {
    const res = place('b1', 'buy', 'ioc', 100, 10);
    expect(res.trades).toHaveLength(0);
    expect(res.order!.status).toBe('cancelled');
    expect(res.order!.filledLots).toBe(0);
  });

  it('handles IOC with partial liquidity', () => {
    place('a1', 'sell', 'limit', 100, 4, 'u1');
    const res = place('b1', 'buy', 'ioc', 100, 10, 'u2');

    expect(res.trades).toHaveLength(1);
    expect(res.trades[0].quantityLots).toBe(4);
    expect(res.order!.status).toBe('partially_filled'); // Or 'cancelled', wait, if it's partially filled, it's terminal. 
    // Wait, the state machine allows 'partially_filled' to be terminal for IOC?
    // In orderbook.ts: order.status = order.filledLots > 0 ? 'partially_filled' : 'cancelled';
    expect(res.order!.status).toBe('partially_filled');
  });

  it('handles cancellation after partial fill', () => {
    const res1 = place('a1', 'sell', 'limit', 100, 10, 'u1');
    place('b1', 'buy', 'limit', 100, 4, 'u2');

    expect(res1.order!.status).toBe('partially_filled');
    
    const cancelled = cancelOrder(engine, res1.order!.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.filledLots).toBe(4);
  });

  it('prevents self-trading (STP = CANCEL_NEWEST)', () => {
    // u1 places an ask
    place('a1', 'sell', 'limit', 100, 10, 'u1');

    // u1 places a bid that would cross
    const res = place('b1', 'buy', 'limit', 100, 5, 'u1');

    // Expected: The newest order (the bid) is cancelled. The resting ask is untouched.
    expect(res.trades).toHaveLength(0);
    expect(res.order!.status).toBe('cancelled');

    const restingAsk = engine.getOrders().get(Array.from(engine.getOrders().values()).filter(o => o.userId === 'u1')[0].id);
    expect(restingAsk?.status).toBe('open');
    expect(restingAsk?.filledLots).toBe(0);
  });
});
