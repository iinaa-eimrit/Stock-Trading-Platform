import * as fs from 'fs';
import * as path from 'path';
import { MatchingEngine } from '../engine/matching-engine';
import { Order } from '../engine/types';

export interface Snapshot {
  snapshotVersion: string;
  engineVersion: string;
  sequenceNumber: bigint;
  createdAt: number;
  orders: Order[];
}

export class Snapshotter {
  constructor(private snapshotDir: string) {
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }
  }

  public takeSnapshot(engine: MatchingEngine): Snapshot {
    const sequence = engine.getSequence();
    const allOrders = engine.getOrders().values();
    
    // Only rest resting orders (open or partially_filled)
    const activeOrders: Order[] = [];
    for (const order of allOrders) {
      if (order.status === 'open' || order.status === 'partially_filled') {
        activeOrders.push(order);
      }
    }

    return {
      snapshotVersion: '1.0',
      engineVersion: '1.0',
      sequenceNumber: sequence,
      createdAt: Date.now(),
      orders: activeOrders,
    };
  }

  public saveSnapshot(snapshot: Snapshot, filename: string): void {
    const filePath = path.join(this.snapshotDir, filename);
    const json = JSON.stringify(snapshot, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );
    fs.writeFileSync(filePath, json);
  }

  public loadLatestSnapshot(): Snapshot | null {
    const files = fs.readdirSync(this.snapshotDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return null;

    // Assuming filenames are lexically sortable, e.g., snapshot_000001000.json
    files.sort();
    const latestFile = files[files.length - 1];

    const json = fs.readFileSync(path.join(this.snapshotDir, latestFile), 'utf-8');
    const parsed = JSON.parse(json);
    if (parsed.sequenceNumber !== undefined) {
      parsed.sequenceNumber = BigInt(parsed.sequenceNumber);
    }
    
    // Convert order sequence numbers
    if (parsed.orders) {
      for (const o of parsed.orders) {
        o.sequenceNumber = BigInt(o.sequenceNumber);
      }
    }
    
    return parsed as Snapshot;
  }
}
