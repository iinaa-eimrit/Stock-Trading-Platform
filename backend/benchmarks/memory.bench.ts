import { Orderbook as ArrayOrderbook } from '../src/engine/orderbook';
import { SkipListOrderbook } from '../src/engine/skiplist-orderbook';
import { IOrderbook, Order } from '../src/engine/types';
import * as os from 'os';

function createOrder(i: number, side: 'buy' | 'sell'): Order {
  return {
    id: `order_${i}`,
    clientOrderId: `client_${i}`,
    userId: `user_${i % 100}`,
    market: 'ETH_USDC',
    side,
    type: 'limit',
    priceTicks: 1000 + (i % 500),
    quantityLots: 10,
    filledLots: 0,
    status: 'open',
    sequenceNumber: BigInt(i),
    createdAt: Date.now(),
  };
}

const implArg = process.argv[2];
if (implArg !== 'Array' && implArg !== 'SkipList') {
  console.error('Usage: node --expose-gc memory.bench.ts <Array|SkipList>');
  process.exit(1);
}

const depth = 100_000;
console.log(`Running isolated memory benchmark for ${implArg} at depth ${depth}`);

if (global.gc) global.gc();
const beforeMemory = process.memoryUsage();

const Implementation = implArg === 'Array' ? ArrayOrderbook : SkipListOrderbook;
const book = new (Implementation as any)('ETH_USDC', 42);
const orders: Order[] = [];

for (let i = 0; i < depth; i++) {
  const side = i % 2 === 0 ? 'buy' : 'sell';
  const order = createOrder(i, side);
  book.addLimitOrder(order, side);
  orders.push(order); // keep strong reference
}

if (global.gc) global.gc();
const afterMemory = process.memoryUsage();

const diff = {
  heapUsed: afterMemory.heapUsed - beforeMemory.heapUsed,
  heapTotal: afterMemory.heapTotal - beforeMemory.heapTotal,
  rss: afterMemory.rss - beforeMemory.rss,
  external: afterMemory.external - beforeMemory.external,
  arrayBuffers: afterMemory.arrayBuffers - beforeMemory.arrayBuffers
};

console.log('--- Result ---');
console.log(`heapUsed: ${(diff.heapUsed / 1024 / 1024).toFixed(2)} MB (${Math.round(diff.heapUsed / depth)} bytes/order)`);
console.log(`heapTotal: ${(diff.heapTotal / 1024 / 1024).toFixed(2)} MB`);
console.log(`rss: ${(diff.rss / 1024 / 1024).toFixed(2)} MB`);
console.log(`external: ${(diff.external / 1024 / 1024).toFixed(2)} MB`);
console.log(`arrayBuffers: ${(diff.arrayBuffers / 1024 / 1024).toFixed(2)} MB`);

// Hold references explicitly until process exit
(global as any).KEEP_ALIVE = { book, orders };
