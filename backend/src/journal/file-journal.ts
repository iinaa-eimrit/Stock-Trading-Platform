import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';
import { ExchangeEvent } from '../events/types';
import { IJournal, JournalRecord } from './types';

export class FileJournal implements IJournal {
  private filePath: string;
  private writeStream: fs.WriteStream | null = null;
  private currentSequence: bigint = 0n;
  private lastHash: string = '0'.repeat(64);

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private initStream() {
    if (!this.writeStream) {
      // Ensure directory exists
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.writeStream = fs.createWriteStream(this.filePath, { flags: 'a' });
    }
  }

  private serializeRecord(event: ExchangeEvent): string {
    const eventStr = JSON.stringify(event, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value
    );
    const hash = crypto.createHash('sha256').update(eventStr + this.lastHash).digest('hex');
    const record: JournalRecord = {
      event,
      previousHash: this.lastHash,
      hash
    };
    this.lastHash = hash;
    return JSON.stringify(record, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value
    );
  }

  private deserializeRecord(line: string): JournalRecord {
    const parsed = JSON.parse(line) as JournalRecord;
    if (parsed.event.sequenceNumber !== undefined) {
      parsed.event.sequenceNumber = BigInt(parsed.event.sequenceNumber);
    }
    return parsed;
  }

  async append(event: ExchangeEvent): Promise<void> {
    this.initStream();
    if (this.currentSequence !== 0n && event.sequenceNumber <= this.currentSequence) {
      throw new Error(`Invalid sequence number: ${event.sequenceNumber}. Current: ${this.currentSequence}`);
    }
    
    return new Promise((resolve, reject) => {
      const line = this.serializeRecord(event) + '\n';
      this.writeStream!.write(line, (err) => {
        if (err) return reject(err);
        this.currentSequence = event.sequenceNumber;
        resolve();
      });
    });
  }

  async appendBatch(events: ExchangeEvent[]): Promise<void> {
    if (events.length === 0) return;
    
    this.initStream();
    let buffer = '';
    
    for (const event of events) {
      if (this.currentSequence !== 0n && event.sequenceNumber <= this.currentSequence) {
        throw new Error(`Invalid sequence number: ${event.sequenceNumber}. Current: ${this.currentSequence}`);
      }
      buffer += this.serializeRecord(event) + '\n';
      this.currentSequence = event.sequenceNumber;
    }

    return new Promise((resolve, reject) => {
      this.writeStream!.write(buffer, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async *readFrom(sequence: bigint): AsyncIterable<ExchangeEvent> {
    if (!fs.existsSync(this.filePath)) return;

    const fileStream = fs.createReadStream(this.filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let expectedPreviousHash = '0'.repeat(64);

    for await (const line of rl) {
      if (!line.trim()) continue;
      
      const record = this.deserializeRecord(line);
      
      // Verify integrity
      if (record.previousHash !== expectedPreviousHash) {
        throw new Error(`Journal corruption detected! Previous hash mismatch at sequence ${record.event.sequenceNumber}`);
      }
      const eventStr = JSON.stringify(record.event, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
      );
      const computedHash = crypto.createHash('sha256').update(eventStr + record.previousHash).digest('hex');
      if (computedHash !== record.hash) {
        throw new Error(`Journal corruption detected! Record hash mismatch at sequence ${record.event.sequenceNumber}`);
      }

      expectedPreviousHash = record.hash;
      this.lastHash = record.hash;
      this.currentSequence = record.event.sequenceNumber;

      if (record.event.sequenceNumber >= sequence) {
        yield record.event;
      }
    }
  }

  async latestSequence(): Promise<bigint> {
    if (!fs.existsSync(this.filePath)) return 0n;

    const fileStream = fs.createReadStream(this.filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let lastSeq = 0n;
    let expectedPreviousHash = '0'.repeat(64);

    for await (const line of rl) {
      if (!line.trim()) continue;
      const record = this.deserializeRecord(line);
      lastSeq = record.event.sequenceNumber;
      expectedPreviousHash = record.hash;
    }
    
    this.currentSequence = lastSeq;
    this.lastHash = expectedPreviousHash;
    return lastSeq;
  }

  async flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.writeStream) {
        // Guarantee durable disk write via fsync
        // We must obtain the file descriptor from the stream. 
        // writeStream.fd might be null if it's not fully opened yet.
        const fd = typeof (this.writeStream as any).fd === 'number' ? (this.writeStream as any).fd : null;
        if (fd !== null) {
          fs.fsync(fd, (err) => {
            if (err) return reject(err);
            resolve();
          });
        } else {
          // If fd is not available yet, just end the stream to flush node buffers
          this.writeStream.end(() => {
            this.writeStream = null;
            resolve();
          });
        }
      } else {
        resolve();
      }
    });
  }
}
