import { Orderbook as ArrayOrderbook } from '../src/engine/orderbook';
import { SkipListOrderbook } from '../src/engine/skiplist-orderbook';
import { OrderSide, OrderType, IOrderbook } from '../src/engine/types';
import * as os from 'os';

function generateRandomOrders(count: number, startSequence = 0, side: OrderSide) {
  const orders = [];
  for (let i = 0; i < count; i++) {
    // Generate deterministic prices for reproducibility
    const price = side === 'buy' ? 1000 + (i % 500) : 2000 + (i % 500);
    orders.push({
      clientOrderId: 'client', id: `ord_${side}_${i}`,
      userId: `u_${i}`,
      market: 'ETH_USDC',
      side,
      type: 'limit' as OrderType,
      priceTicks: Math.floor(price),
      quantityLots: 1,
      filledLots: 0,
      status: 'open' as any,
      createdAt: 1000000 + i,
      sequenceNumber: BigInt(startSequence + i),
    });
  }
  return orders;
}

function median(values: bigint[]) {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)];
}

function measureBook(book: IOrderbook, depth: number) {
  // Prefill orderbook
  const bids = generateRandomOrders(depth / 2, 0, 'buy');
  const asks = generateRandomOrders(depth / 2, depth / 2, 'sell');

  for (const b of bids) book.addLimitOrder({ ...b }, 'buy');
  for (const a of asks) book.addLimitOrder({ ...a }, 'sell');

  const testCount = 1000;
  
  // 1. Insert Test
  const inserts = generateRandomOrders(testCount, depth, 'buy');
  const insertTimes: bigint[] = [];
  for (let i = 0; i < testCount; i++) {
    const start = process.hrtime.bigint();
    book.addLimitOrder({ ...inserts[i] }, 'buy');
    const end = process.hrtime.bigint();
    insertTimes.push(end - start);
  }
  const insertMed = Number(median(insertTimes)) / 1000;

  // 2. Match Test
  const matchTimes: bigint[] = [];
  for (let i = 0; i < testCount; i++) {
    const order = {
      clientOrderId: 'client', id: `mkt_${i}`,
      userId: `mkt_u_${i}`,
      market: 'ETH_USDC',
      side: 'sell' as OrderSide,
      type: 'market' as OrderType,
      priceTicks: 0,
      quantityLots: 0.1,
      filledLots: 0,
      status: 'open' as any,
      createdAt: Date.now(),
      sequenceNumber: BigInt(depth + testCount + i),
    };
    const start = process.hrtime.bigint();
    book.addMarketOrder(order, 'sell');
    const end = process.hrtime.bigint();
    matchTimes.push(end - start);
  }
  const matchMed = Number(median(matchTimes)) / 1000;

  // 3. Cancel Test
  const cancelTimes: bigint[] = [];
  for (let i = 0; i < testCount; i++) {
    const targetId = bids[i % bids.length].id;
    const start = process.hrtime.bigint();
    book.cancelOrder(targetId);
    const end = process.hrtime.bigint();
    cancelTimes.push(end - start);
  }
  const cancelMed = Number(median(cancelTimes)) / 1000;

  return { insertMed, matchMed, cancelMed };
}

function runMicrobenchmarks() {
  console.log(`Orderbook Microbenchmarks (OS: ${os.platform()}, CPU: ${os.cpus()[0].model})`);
  console.log(`\nDepth\t| Implementation\t| Insert (μs)\t| Match (μs)\t| Cancel (μs)`);
  console.log(`--------------------------------------------------------------------------------`);
  
  const depths = [1000, 10_000, 50_000, 100_000];
  for (const depth of depths) {
    let arrayBook: ArrayOrderbook | null = new ArrayOrderbook('ETH_USDC');
    const arrayRes = measureBook(arrayBook, depth);
    console.log(`${depth}\t| Array\t\t\t| ${arrayRes.insertMed.toFixed(2)}\t\t| ${arrayRes.matchMed.toFixed(2)}\t\t| ${arrayRes.cancelMed.toFixed(2)}`);
    arrayBook = null;
    if (global.gc) global.gc();

    let skipBook: SkipListOrderbook | null = new SkipListOrderbook('ETH_USDC', 42);
    const skipRes = measureBook(skipBook, depth);
    console.log(`${depth}\t| SkipList\t\t| ${skipRes.insertMed.toFixed(2)}\t\t| ${skipRes.matchMed.toFixed(2)}\t\t| ${skipRes.cancelMed.toFixed(2)}`);
    console.log(`--------------------------------------------------------------------------------`);
    skipBook = null;
    if (global.gc) global.gc();
  }
}

runMicrobenchmarks();
