import { Orderbook as ArrayOrderbook } from '../src/engine/orderbook';
import { SkipListOrderbook } from '../src/engine/skiplist-orderbook';
import { Order, IOrderbook } from '../src/engine/types';

function createOrder(i: number, side: 'buy' | 'sell'): Order {
  return {
    id: `order_${i}`,
    clientOrderId: `client_${i}`,
    userId: `user_${i % 100}`,
    market: 'ETH_USDC',
    side,
    type: 'limit',
    priceTicks: side === 'buy' ? 1000 + (i % 10) : 3000 + (i % 10), // slight clustering
    quantityLots: 10,
    filledLots: 0,
    status: 'open',
    sequenceNumber: BigInt(i),
    createdAt: Date.now(),
  };
}

function runCancelBenchmarkForDepth(depth: number) {
  // Pre-generate EXACT same sequence of orders for both
  const orders: Order[] = [];
  for (let i = 0; i < depth; i++) {
    const side = i % 2 === 0 ? 'buy' : 'sell';
    orders.push(createOrder(i, side));
  }

  // Pre-generate EXACT same randomized cancellation sequence
  const cancelIds = orders.map(o => o.id);
  // deterministic shuffle (simple seeded random)
  let m_w = 123456789;
  let m_z = 987654321;
  const mask = 0xffffffff;
  function seedRandom() {
    m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
    m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;
    let result = ((m_z << 16) + m_w) & mask;
    result /= 4294967296;
    return result + 0.5;
  }
  
  for (let i = cancelIds.length - 1; i > 0; i--) {
    const j = Math.floor(seedRandom() * (i + 1));
    [cancelIds[i], cancelIds[j]] = [cancelIds[j], cancelIds[i]];
  }

  // ARRAY BENCHMARK
  const arrayBook = new ArrayOrderbook('ETH_USDC');
  for (const o of orders) arrayBook.addLimitOrder({ ...o }, o.side);
  
  const arrayStart = process.hrtime.bigint();
  for (const id of cancelIds) arrayBook.cancelOrder(id);
  const arrayEnd = process.hrtime.bigint();
  const arrayLatencyMs = Number(arrayEnd - arrayStart) / 1e6;

  // SKIPLIST BENCHMARK
  const skipBook = new SkipListOrderbook('ETH_USDC', 42);
  for (const o of orders) skipBook.addLimitOrder({ ...o }, o.side);

  const skipStart = process.hrtime.bigint();
  for (const id of cancelIds) skipBook.cancelOrder(id);
  const skipEnd = process.hrtime.bigint();
  const skipLatencyMs = Number(skipEnd - skipStart) / 1e6;

  console.log(`${depth}\t| ${arrayLatencyMs.toFixed(2)} ms\t\t| ${skipLatencyMs.toFixed(2)} ms`);
}

console.log('Cancellation Latency Scaling Benchmark');
console.log('Depth\t| ArrayOrderbook\t| SkipListOrderbook');
console.log('--------------------------------------------------');

const depths = [1000, 5000, 10000, 20000, 30000, 50000];
for (const depth of depths) {
  runCancelBenchmarkForDepth(depth);
}
