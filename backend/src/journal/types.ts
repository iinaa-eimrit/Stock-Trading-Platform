import { ExchangeEvent } from '../events/types';

export interface IJournal {
  append(event: ExchangeEvent): Promise<void>;
  appendBatch(events: ExchangeEvent[]): Promise<void>;
  readFrom(sequence: bigint): AsyncIterable<ExchangeEvent>;
  latestSequence(): Promise<bigint>;
  flush(): Promise<void>;
}

export interface JournalRecord {
  event: ExchangeEvent;
  previousHash: string;
  hash: string;
}
