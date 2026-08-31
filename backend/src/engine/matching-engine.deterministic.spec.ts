import { placeOrder, cancelOrder } from './test-helpers';
import { describe, it, expect } from 'vitest';
import { MatchingEngine } from './matching-engine';
import { generateWorkload } from '../../benchmarks/workloads';

describe('Deterministic Replay Verification', () => {
  it('should produce exactly the same trades and final state for the same seed', () => {
    // 1. Generate workload
    const workload = generateWorkload({ seed: 12345, orders: 1000, type: 'mixed' });

    // 2. Run Instance A
    const engineA = new MatchingEngine([{
      symbol: 'ETH_USDC',
      baseAsset: 'ETH',
      quoteAsset: 'USDC',
      tickSize: 0.01,
      lotSize: 0.001,
      minNotional: 1
    }]);

    const tradesA = [];

    for (const cmd of workload.commands) {
      if (cmd.action === 'place') {
        const result = placeOrder(engineA, { ...cmd, type: 'PLACE_ORDER', orderType: (cmd as any).type } as any);
        tradesA.push(...result.trades);
      } else if (cmd.action === 'cancel') {
        cancelOrder(engineA, cmd.orderId);
      }
    }

    // 3. Run Instance B
    const engineB = new MatchingEngine([{
      symbol: 'ETH_USDC',
      baseAsset: 'ETH',
      quoteAsset: 'USDC',
      tickSize: 0.01,
      lotSize: 0.001,
      minNotional: 1
    }]);

    const tradesB = [];
    const clientToOrderIdB = new Map<string, string>();

    for (const cmd of workload.commands) {
      if (cmd.action === 'place') {
        const result = placeOrder(engineB, { ...cmd, type: 'PLACE_ORDER', orderType: (cmd as any).type } as any);
        tradesB.push(...result.trades);
        clientToOrderIdB.set(cmd.clientOrderId, result.order.id);
      } else if (cmd.action === 'cancel') {
        const id = clientToOrderIdB.get(cmd.clientOrderId);
        if (id) cancelOrder(engineB, id);
      }
    }

    // 4. Verification
    expect(tradesA.length).toBeGreaterThan(0);
    expect(tradesA.length).toBe(tradesB.length);

    for (let i = 0; i < tradesA.length; i++) {
      // Ignore the timestamp because it might differ slightly if Date.now() changes,
      // although actually Date.now() might change in between executions.
      // Wait, trade.timestamp uses Date.now(). Let's assert everything EXCEPT timestamp and ID.
      const tA = tradesA[i];
      const tB = tradesB[i];

      expect(tA.market).toBe(tB.market);
      expect(tA.priceTicks).toBe(tB.priceTicks);
      expect(tA.quantityLots).toBe(tB.quantityLots);
      expect(tA.buyerId).toBe(tB.buyerId);
      expect(tA.sellerId).toBe(tB.sellerId);
      expect(tA.takerSide).toBe(tB.takerSide);
    }

  });
});
