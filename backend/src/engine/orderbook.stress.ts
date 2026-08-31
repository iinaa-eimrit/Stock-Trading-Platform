import * as fc from 'fast-check';
import { Orderbook as ArrayOrderbook } from './orderbook';
import { SkipListOrderbook } from './skiplist-orderbook';
import { OrderSide, OrderType, Order } from './types';

// We want to generate realistic inputs.
const genSide = fc.constantFrom<OrderSide>('buy', 'sell');
const genType = fc.constantFrom<OrderType>('limit', 'market', 'ioc');
const genPriceTicks = fc.integer({ min: 10, max: 200 });
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
  orderIndexToCancel: number;
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
  return fc.boolean({ probability: 0.2 }).chain((isCancel) => 
    isCancel ? cancelGen : placeGen
  );
});

// 1. Generate 100,000 commands using a deterministic seed
const seed = 42;
const generated = fc.sample(
  fc.array(commandGenerator, { minLength: 100_000, maxLength: 100_000 }),
  { seed, numRuns: 1 }
);
const commands = generated[0];

console.log('Commands generated. Starting differential stress test...');

const arrayBook = new ArrayOrderbook('ETH_USDC');
const skipBook = new SkipListOrderbook('ETH_USDC', seed);

let sequence = 0n;
const startTime = process.hrtime.bigint();

for (let i = 0; i < commands.length; i++) {
  const cmd = commands[i];
  sequence++;

  try {
    if (cmd.type === 'place') {
      const order = {
        id: `ord_${sequence}`,
        clientOrderId: cmd.clientOrderId,
        userId: 'user_1',
        market: 'ETH_USDC',
        side: cmd.side,
        type: cmd.orderType,
        priceTicks: cmd.priceTicks,
        quantityLots: cmd.quantityLots,
        filledLots: 0,
        status: 'open' as const,
        createdAt: 1000 + i,
        sequenceNumber: sequence,
      };

      const o1 = { ...order };
      const o2 = { ...order };

      const trades1 = cmd.orderType === 'market' ? arrayBook.addMarketOrder(o1, cmd.side) : arrayBook.addLimitOrder(o1, cmd.side);
      const trades2 = cmd.orderType === 'market' ? skipBook.addMarketOrder(o2, cmd.side) : skipBook.addLimitOrder(o2, cmd.side);

      // Verify trades
      if (JSON.stringify(trades1, (k, v) => typeof v === 'bigint' ? v.toString() : v) !== 
          JSON.stringify(trades2, (k, v) => typeof v === 'bigint' ? v.toString() : v)) {
        throw new Error(`Trades mismatch at sequence ${sequence}`);
      }

    } else if (cmd.type === 'cancel') {
      const activeOrders = arrayBook.asks.concat(arrayBook.bids);
      if (activeOrders.length > 0) {
        const targetOrder = activeOrders[cmd.orderIndexToCancel % activeOrders.length];
        arrayBook.cancelOrder(targetOrder.id);
        skipBook.cancelOrder(targetOrder.id);
      }
    }

    // Verify full state every 10,000 ops to keep it fast, but strictly check final state
    if (i % 10000 === 0 || i === commands.length - 1) {
      const snap1 = JSON.stringify(arrayBook.getAggregatedBook(100), (k, v) => typeof v === 'bigint' ? v.toString() : v);
      const snap2 = JSON.stringify(skipBook.getAggregatedBook(100), (k, v) => typeof v === 'bigint' ? v.toString() : v);
      if (snap1 !== snap2) {
        throw new Error(`Snapshot mismatch at sequence ${sequence}`);
      }
      console.log(`Verified ${i + 1} operations...`);
    }

  } catch (err: any) {
    console.error(`FAILED at sequence ${sequence} (index ${i}):`, err.message);
    process.exit(1);
  }
}

const endTime = process.hrtime.bigint();
const ms = Number(endTime - startTime) / 1e6;

console.log(`\nSUCCESS: Both orderbooks maintained exact equivalence across 100,000 operations!`);
console.log(`Stress test completed in ${ms.toFixed(0)} ms.`);
