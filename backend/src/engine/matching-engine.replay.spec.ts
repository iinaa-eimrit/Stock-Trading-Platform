import { placeOrder, cancelOrder } from './test-helpers';
import { describe, it, expect } from 'vitest';
import { MatchingEngine } from './matching-engine';
import { OrderSide, OrderType, Order } from './types';

interface Command {
  userId: string;
  clientOrderId: string;
  market: string;
  side: OrderSide;
  orderType: OrderType;
  priceTicks: number;
  quantityLots: number;
}

describe('MatchingEngine (Layer B - Deterministic Replay)', () => {
  it('produces identical state when given identical commands', () => {
    const commands: Command[] = [
      { userId: 'u1', clientOrderId: 'c1', market: 'ETH_USDC', side: 'sell', orderType: 'limit', priceTicks: 100, quantityLots: 5 },
      { userId: 'u2', clientOrderId: 'c2', market: 'ETH_USDC', side: 'sell', orderType: 'limit', priceTicks: 101, quantityLots: 5 },
      { userId: 'u3', clientOrderId: 'c3', market: 'ETH_USDC', side: 'buy', orderType: 'limit', priceTicks: 99, quantityLots: 2 },
      { userId: 'u4', clientOrderId: 'c4', market: 'ETH_USDC', side: 'buy', orderType: 'limit', priceTicks: 100, quantityLots: 3 },
      { userId: 'u5', clientOrderId: 'c5', market: 'ETH_USDC', side: 'buy', orderType: 'market', priceTicks: 0, quantityLots: 4 },
      { userId: 'u1', clientOrderId: 'c6', market: 'ETH_USDC', side: 'sell', orderType: 'ioc', priceTicks: 98, quantityLots: 10 },
    ];

    const runEngine = (cmds: Command[]) => {
      const engine = new MatchingEngine([{ symbol: 'ETH_USDC', baseAsset: 'ETH', quoteAsset: 'USDC', tickSize: 0.01, lotSize: 0.001, minNotional: 1 }]);
      
      const results = [];
      for (const cmd of cmds) {
        const res = placeOrder(engine, cmd);
        results.push(res);
      }

      // Also let's cancel one
      const cancelRes = cancelOrder(engine, 'c2'); // wait, order ID is UUID, we can't cancel by clientOrderId currently.
      // We need to look up order by clientOrderId or just cancel by the UUID we recorded.
      const uuidToCancel = results[1].order!.id;
      cancelOrder(engine, uuidToCancel);

      const allTrades = results.flatMap(r => r.trades).map((t: any) => ({ ...t, timestamp: 0, buyOrderId: '', sellOrderId: '' }));
      return {
        book: engine.getOrderbook('ETH_USDC'),
        trades: allTrades,
        orders: Array.from(engine.getOrders().values()).filter(o => o.userId === 'u1').map(o => ({ ...o, createdAt: 0, id: '' })), 
      };
    };

    const stateA = runEngine(commands);
    const stateB = runEngine(commands);

    expect(stateA).toEqual(stateB);
  });
});
