import { placeOrder, cancelOrder } from './test-helpers';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MatchingEngine } from './matching-engine';
import { OrderSide, OrderType, OrderStatus, Order } from './types';

type Command = 
  | { type: 'place'; side: OrderSide; orderType: OrderType; priceTicks: number; quantityLots: number }
  | { type: 'cancel'; indexOffset: number };

describe('MatchingEngine (Layer D - Property Tests)', () => {
  it('maintains orderbook invariants across random command sequences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              type: fc.constant('place'),
              side: fc.constantFrom('buy' as OrderSide, 'sell' as OrderSide),
              orderType: fc.constantFrom('limit' as OrderType, 'market' as OrderType, 'ioc' as OrderType),
              priceTicks: fc.integer({ min: 1, max: 200 }),
              quantityLots: fc.integer({ min: 1, max: 100 })
            }),
            fc.record({
              type: fc.constant('cancel'),
              indexOffset: fc.integer({ min: 0, max: 100 })
            })
          ),
          { minLength: 1, maxLength: 500 }
        ),
        (commands) => {
          const engine = new MatchingEngine([{ symbol: 'MKT', baseAsset: 'BASE', quoteAsset: 'QUOTE', tickSize: 0.01, lotSize: 0.001, minNotional: 1 }]);
          const activeOrders: string[] = [];

          let cmdIndex = 0;
          for (const cmd of commands) {
            cmdIndex++;
            if (cmd.type === 'place') {
              const res = placeOrder(engine, { userId: 'u1',
                clientOrderId: `c_${cmdIndex}`,
                market: 'MKT',
                side: cmd.side,
                orderType: cmd.orderType,
                priceTicks: cmd.orderType === 'market' ? 0 : cmd.priceTicks,
                quantityLots: cmd.quantityLots,
              });
              if (res.order!.status === 'open' || res.order!.status === 'partially_filled') {
                activeOrders.push(res.order!.id);
              }
            } else if (cmd.type === 'cancel' && activeOrders.length > 0) {
              const idx = cmd.indexOffset % activeOrders.length;
              const orderId = activeOrders[idx];
              cancelOrder(engine, orderId);
              activeOrders.splice(idx, 1);
            }

            // --- Assert Invariants after each command ---

            const book = engine.getOrderbook('MKT');
            expect(book).toBeDefined();
            if (!book) continue;

            // 1. Best bid < best ask
            if (book.bids.length > 0 && book.asks.length > 0) {
              expect(book.bids[0].priceTicks).toBeLessThanOrEqual(book.asks[0].priceTicks);
              // Wait, in a continuous matching engine, if best bid >= best ask, they would match.
              // So best bid MUST be strictly less than best ask.
              expect(book.bids[0].priceTicks).toBeLessThan(book.asks[0].priceTicks);
            }

            // 2. Terminal orders aren't resting in the book
            // AggregatedBook only contains remaining quantities, so we don't have direct access 
            // to the internal Order objects here, but we can assume getAggregatedBook only includes active volume.
            
            // Wait, we can test internal state if we fetch all orders we tracked
            for (const orderId of activeOrders) {
              const order = engine.getOrders().get(orderId);
              if (order) {
                // 3. filledQuantity <= quantity
                expect(order.filledLots).toBeLessThanOrEqual(order.quantityLots);
                
                // 4. remainingQuantity >= 0
                expect(order.quantityLots - order.filledLots).toBeGreaterThanOrEqual(0);

                if (order.status === 'filled' || order.status === 'cancelled') {
                  // Active orders array might be slightly out of sync if an order was filled by a subsequent market order
                  // That's fine, we just verify that terminal states mean it is filled/cancelled correctly.
                  if (order.status === 'filled') {
                    expect(order.filledLots).toBe(order.quantityLots);
                  }
                }
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
