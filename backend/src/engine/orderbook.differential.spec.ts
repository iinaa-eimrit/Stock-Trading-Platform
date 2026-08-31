import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Orderbook as ArrayOrderbook } from './orderbook';
import { SkipListOrderbook } from './skiplist-orderbook';
import { OrderSide, OrderType, Order } from './types';

// We want to generate realistic inputs.
const genSide = fc.constantFrom<OrderSide>('buy', 'sell');
const genType = fc.constantFrom<OrderType>('limit', 'market', 'ioc');
const genPriceTicks = fc.integer({ min: 10, max: 200 }); // keep tight spread to force matches
const genQuantityLots = fc.integer({ min: 1, max: 100 });

interface CommandPlace {
  type: 'place';
  clientOrderId: string;
  side: OrderSide;
  orderType: OrderType;
  priceTicks: number;
  quantityLots: number;
}

interface CommandCancel {
  type: 'cancel';
  orderIndexToCancel: number; // Modulo number of active orders
}

type Command = CommandPlace | CommandCancel;

const commandGenerator = fc.tuple(
  fc.string({ minLength: 4, maxLength: 8 }),
  genSide,
  genType,
  genPriceTicks,
  genQuantityLots
).chain(([id, side, type, price, qty]) => {
  const placeGen = fc.record<CommandPlace>({
    type: fc.constant('place'),
    clientOrderId: fc.constant(id),
    side: fc.constant(side),
    orderType: fc.constant(type),
    priceTicks: fc.constant(price),
    quantityLots: fc.constant(qty),
  });
  
  const cancelGen = fc.record<CommandCancel>({
    type: fc.constant('cancel'),
    orderIndexToCancel: fc.nat(),
  });

  // 20% chance to cancel, 80% to place
  return fc.integer({ min: 1, max: 5 }).chain(n =>
    (n === 1 ? cancelGen : placeGen) as fc.Arbitrary<Command>
  );
});

describe('Differential Testing: ArrayOrderbook vs SkipListOrderbook', () => {
  it('should maintain exact state equivalence across all operations', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(commandGenerator, { minLength: 10, maxLength: 1000 }), (seed, commands) => {
        const arrayBook = new ArrayOrderbook('TEST');
        const skipBook = new SkipListOrderbook('TEST', seed);
        
        const activeOrders: string[] = []; // Track orders for cancellation
        let sequence = 0n;

        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i];

          if (cmd.type === 'place') {
            sequence++;
            const order: Order = {
              id: `order_${i}`,
              clientOrderId: cmd.clientOrderId,
              userId: 'u1',
              market: 'TEST',
              side: cmd.side,
              type: cmd.orderType,
              priceTicks: cmd.orderType === 'market' ? 0 : cmd.priceTicks,
              quantityLots: cmd.quantityLots,
              filledLots: 0,
              status: 'open',
              sequenceNumber: sequence,
              createdAt: 1000 + i,
            };

            // Deep clone manually because sequenceNumber is a BigInt
            const o1 = { ...order };
            const o2 = { ...order };

            const trades1 = cmd.orderType === 'market' ? arrayBook.addMarketOrder(o1, cmd.side) : arrayBook.addLimitOrder(o1, cmd.side);
            const trades2 = cmd.orderType === 'market' ? skipBook.addMarketOrder(o2, cmd.side) : skipBook.addLimitOrder(o2, cmd.side);

            // Assert exact trades equivalence
            expect(trades1).toEqual(trades2);
            
            // Assert inserted order state equivalence
            expect(o1).toEqual(o2);

            if (o1.status === 'open' || o1.status === 'partially_filled') {
              activeOrders.push(o1.id);
            }

          } else if (cmd.type === 'cancel' && activeOrders.length > 0) {
            const idx = cmd.orderIndexToCancel % activeOrders.length;
            const orderId = activeOrders[idx];
            activeOrders.splice(idx, 1);

            const cancelled1 = arrayBook.cancelOrder(orderId);
            const cancelled2 = skipBook.cancelOrder(orderId);

            expect(cancelled1).toEqual(cancelled2);
          }

          // Assert global book snapshot equivalence after EVERY command
          expect(arrayBook.getAggregatedBook(20)).toEqual(skipBook.getAggregatedBook(20));
          expect(arrayBook.lastTradePriceTicks).toEqual(skipBook.lastTradePriceTicks);
          
          // Verify quotes equivalence
          expect(arrayBook.getQuote('buy', 10)).toEqual(skipBook.getQuote('buy', 10));
          expect(arrayBook.getQuote('sell', 10)).toEqual(skipBook.getQuote('sell', 10));
        }
      }),
      { numRuns: 100, seed: 42 } // Fast-check config
    );
  });
});
