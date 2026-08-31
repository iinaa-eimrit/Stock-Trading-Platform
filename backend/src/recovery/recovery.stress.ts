// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import * as fc from 'fast-check';
import { MatchingEngine } from '../engine/matching-engine';
import { SkipListOrderbook } from '../engine/skiplist-orderbook';
import { FileJournal } from '../journal/file-journal';
import { Snapshotter } from './snapshot';
import { Replayer } from './replayer';
import { ExchangeCommand } from '../events/commands';
import { OrderSide, OrderType } from '../engine/types';

const journalFile = path.join(__dirname, '../../data/journal.jsonl');
const snapshotDir = path.join(__dirname, '../../data/snapshots');

// Clean up
if (fs.existsSync(journalFile)) fs.unlinkSync(journalFile);
if (fs.existsSync(snapshotDir)) fs.rmSync(snapshotDir, { recursive: true, force: true });
fs.mkdirSync(snapshotDir, { recursive: true });

// Generator
const genSide = fc.constantFrom<OrderSide>('buy', 'sell');
const genType = fc.constantFrom<OrderType>('limit', 'market', 'ioc');
const genPriceTicks = fc.integer({ min: 10, max: 200 });
const genQuantityLots = fc.integer({ min: 1, max: 100 });

const commandGenerator = fc.tuple(
  fc.string({ minLength: 4, maxLength: 8 }),
  genSide,
  genType,
  genPriceTicks,
  genQuantityLots
).chain(([id, side, type, price, qty]) => {
  return fc.boolean({ probability: 0.2 }).chain(isCancel => {
    if (isCancel) {
      return fc.record({
        type: fc.constant('CANCEL_ORDER' as const),
        market: fc.constant('ETH_USDC'),
        orderIndexToCancel: fc.nat(),
      });
    } else {
      return fc.record({
        type: fc.constant('PLACE_ORDER' as const),
        market: fc.constant('ETH_USDC'),
        clientOrderId: fc.constant(id),
        userId: fc.constant('user_1'),
        side: fc.constant(side),
        orderType: fc.constant(type),
        priceTicks: fc.constant(price),
        quantityLots: fc.constant(qty),
      });
    }
  });
});

async function runRecoveryTest() {
  console.log('Generating 10,000 deterministic commands...');
  const commands = fc.sample(
    fc.array(commandGenerator, { minLength: 10000, maxLength: 10000 }),
    { seed: 42, numRuns: 1 }
  )[0];

  const engine = new MatchingEngine([{ symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.001 }], (m) => new SkipListOrderbook(m, 42));
  const journal = new FileJournal(journalFile);
  const snapshotter = new Snapshotter(snapshotDir);

  console.log('Applying first 5000 commands...');
  
  // Track active order IDs to enable valid cancellations
  const activeOrders: string[] = [];

  for (let i = 0; i < 5000; i++) {
    const rawCmd = commands[i];
    let cmd: ExchangeCommand;
    
    if (rawCmd.type === 'PLACE_ORDER') {
      cmd = rawCmd as ExchangeCommand;
    } else {
      if (activeOrders.length === 0) continue;
      const targetId = activeOrders[rawCmd.orderIndexToCancel % activeOrders.length];
      cmd = { type: 'CANCEL_ORDER', market: 'ETH_USDC', orderId: targetId, userId: 'user_1' };
    }

    const events = engine.processCommand(cmd);
    await journal.appendBatch(events);

    // Track active orders for cancel
    for (const event of events) {
      if (event.type === 'ORDER_ACCEPTED') {
        activeOrders.push(event.orderId);
      }
    }
  }

  console.log('Taking snapshot at sequence 5000...');
  const snapshot = snapshotter.takeSnapshot(engine);
  snapshotter.saveSnapshot(snapshot, 'snapshot_5000.json');

  console.log('Applying remaining 5000 commands...');
  for (let i = 5000; i < commands.length; i++) {
    const rawCmd = commands[i];
    let cmd: ExchangeCommand;
    
    if (rawCmd.type === 'PLACE_ORDER') {
      cmd = rawCmd as ExchangeCommand;
    } else {
      if (activeOrders.length === 0) continue;
      const targetId = activeOrders[rawCmd.orderIndexToCancel % activeOrders.length];
      cmd = { type: 'CANCEL_ORDER', market: 'ETH_USDC', orderId: targetId, userId: 'user_1' };
    }

    const events = engine.processCommand(cmd);
    await journal.appendBatch(events);
    
    for (const event of events) {
      if (event.type === 'ORDER_ACCEPTED') {
        activeOrders.push(event.orderId);
      }
    }
  }

  // Force flush just in case
  await journal.flush();

  const originalState = JSON.stringify(engine.getOrderbook('ETH_USDC'), (k, v) => typeof v === 'bigint' ? v.toString() : v);

  console.log('--- SIMULATING CRASH ---');
  
  // Crash and recover
  const recoveredEngine = new MatchingEngine([{ symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.001 }], (m) => new SkipListOrderbook(m, 42));
  const recoveredSnapshot = snapshotter.loadLatestSnapshot();
  const replayer = new Replayer(journal);

  console.log(`Recovering from snapshot sequence ${recoveredSnapshot?.sequenceNumber}...`);
  await replayer.recoverEngine(recoveredEngine, recoveredSnapshot);

  const recoveredState = JSON.stringify(recoveredEngine.getOrderbook('ETH_USDC'), (k, v) => typeof v === 'bigint' ? v.toString() : v);

  if (originalState === recoveredState) {
    console.log('SUCCESS: Recovered orderbook identically matches the original state!');
  } else {
    console.error('FAILURE: Mismatch in recovered state.');
    fs.writeFileSync(path.join(__dirname, 'original.json'), originalState);
    fs.writeFileSync(path.join(__dirname, 'recovered.json'), recoveredState);
    process.exit(1);
  }
}

runRecoveryTest().catch(console.error);
