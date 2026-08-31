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

const journalFile = path.join(__dirname, '../../data/journal_hostile.jsonl');
const snapshotDir = path.join(__dirname, '../../data/snapshots_hostile');

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

async function runHostileTest() {
  console.log('Generating deterministic commands for hostile test...');
  const commands = fc.sample(
    fc.array(commandGenerator, { minLength: 2000, maxLength: 2000 }),
    { seed: 1337, numRuns: 1 }
  )[0];

  const crashIndex = 1500; // Hardcode a random-ish crash point

  // 1. Build Reference Engine (No Crash)
  console.log(`Building Reference Engine up to ${crashIndex} commands...`);
  const refEngine = new MatchingEngine([{ symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.001 }], (m) => new SkipListOrderbook(m, 42));
  const activeOrdersForRef: string[] = [];

  for (let i = 0; i < crashIndex; i++) {
    const rawCmd = commands[i];
    let cmd: ExchangeCommand;
    if (rawCmd.type === 'PLACE_ORDER') {
      cmd = rawCmd as ExchangeCommand;
    } else {
      if (activeOrdersForRef.length === 0) continue;
      const targetId = activeOrdersForRef[rawCmd.orderIndexToCancel % activeOrdersForRef.length];
      cmd = { type: 'CANCEL_ORDER', market: 'ETH_USDC', orderId: targetId, userId: 'user_1' };
    }
    const events = refEngine.processCommand(cmd);
    for (const event of events) {
      if (event.type === 'ORDER_ACCEPTED') activeOrdersForRef.push(event.orderId);
    }
  }

  const referenceState = JSON.stringify(refEngine.getOrderbook('ETH_USDC'), (k, v) => typeof v === 'bigint' ? v.toString() : v);

  // 2. Build Crash Engine
  if (fs.existsSync(journalFile)) fs.unlinkSync(journalFile);
  if (fs.existsSync(snapshotDir)) fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.mkdirSync(snapshotDir, { recursive: true });

  const engine = new MatchingEngine([{ symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.001 }], (m) => new SkipListOrderbook(m, 42));
  const journal = new FileJournal(journalFile);
  const snapshotter = new Snapshotter(snapshotDir);
  const activeOrders: string[] = [];

  console.log('Applying commands and journaling...');
  for (let i = 0; i < crashIndex; i++) {
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
    
    // Simulate panic mid-batch if this is the crash command
    if (i === crashIndex - 1) {
      // Intentionally only write HALF the events for this command to simulate partial batch flush
      if (events.length > 1) {
        await journal.append(events[0]); 
        // DO NOT write the rest. Process "dies".
      } else {
        await journal.appendBatch(events);
      }
      break;
    } else {
      await journal.appendBatch(events);
    }

    for (const event of events) {
      if (event.type === 'ORDER_ACCEPTED') activeOrders.push(event.orderId);
    }
    
    if (i === 1000) {
      const snap = snapshotter.takeSnapshot(engine);
      snapshotter.saveSnapshot(snap, 'snap_1000.json');
    }
  }

  await journal.flush();

  // 3. Corrupt the Journal (Simulate bit flip or partial record)
  // Let's modify the last byte of the file to simulate partial write
  const stats = fs.statSync(journalFile);
  const fd = fs.openSync(journalFile, 'r+');
  const buffer = Buffer.from('x');
  fs.writeSync(fd, buffer, 0, 1, stats.size - 5);
  fs.closeSync(fd);

  console.log('--- CRASH AND RECOVERY ---');
  
  const recoveredEngine = new MatchingEngine([{ symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.001 }], (m) => new SkipListOrderbook(m, 42));
  const recoveredSnapshot = snapshotter.loadLatestSnapshot();
  const replayer = new Replayer(journal);

  try {
    console.log(`Recovering from snapshot sequence ${recoveredSnapshot?.sequenceNumber}...`);
    await replayer.recoverEngine(recoveredEngine, recoveredSnapshot);
    console.error('FAILURE: The journal corruption was silently ignored!');
    process.exit(1);
  } catch (err: any) {
    if (err.message.includes('Journal corruption detected') || err.message.includes('Unexpected token')) {
      console.log('SUCCESS: Journal corruption correctly detected and prevented silent replay.');
      console.log('Error message:', err.message);
    } else {
      console.error('FAILURE: Unexpected error during recovery:', err);
      process.exit(1);
    }
  }
}

runHostileTest().catch(console.error);
