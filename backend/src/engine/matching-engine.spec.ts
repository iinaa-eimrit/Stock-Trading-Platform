import { placeOrder, cancelOrder } from './test-helpers';
import { describe, it, expect, beforeEach } from 'vitest';
import { MatchingEngine } from './matching-engine';

describe('MatchingEngine (Layer A - Pure Engine)', () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    engine = new MatchingEngine([{ symbol: 'ETH_USDC', baseAsset: 'ETH', quoteAsset: 'USDC', tickSize: 0.01, lotSize: 0.001, minNotional: 1 }]);
  });

  
  describe('Price-Time Priority', () => {
    it('should match earlier sequence numbers first at the same price', () => {
      placeOrder(engine, { userId: 'u1',
        clientOrderId: 'ask1',
        market: 'ETH_USDC',
        side: 'sell',
        orderType: 'limit',
        priceTicks: 100,
        quantityLots: 1,
      });
      placeOrder(engine, { userId: 'u2',
        clientOrderId: 'ask2',
        market: 'ETH_USDC',
        side: 'sell',
        orderType: 'limit',
        priceTicks: 100,
        quantityLots: 1,
      });

      const res = placeOrder(engine, { userId: 'u3',
        clientOrderId: 'bid1',
        market: 'ETH_USDC',
        side: 'buy',
        orderType: 'limit',
        priceTicks: 100,
        quantityLots: 1,
      });

      expect(res.trades).toHaveLength(1);
      expect(res.trades[0].sellerId).toBe('u1'); // u1 was first
    });

    it('should prioritize better prices over earlier sequence numbers', () => {
      placeOrder(engine, { userId: 'u1',
        clientOrderId: 'ask1',
        market: 'ETH_USDC',
        side: 'sell',
        orderType: 'limit',
        priceTicks: 100,
        quantityLots: 1,
      });
      placeOrder(engine, { userId: 'u2',
        clientOrderId: 'ask2',
        market: 'ETH_USDC',
        side: 'sell',
        orderType: 'limit',
        priceTicks: 99,
        quantityLots: 1,
      });

      const res = placeOrder(engine, { userId: 'u3',
        clientOrderId: 'bid1',
        market: 'ETH_USDC',
        side: 'buy',
        orderType: 'limit',
        priceTicks: 100,
        quantityLots: 1,
      });

      expect(res.trades).toHaveLength(1);
      expect(res.trades[0].sellerId).toBe('u2'); // u2 had better price (99)
      expect(res.trades[0].priceTicks).toBe(99);
    });
  });
});
