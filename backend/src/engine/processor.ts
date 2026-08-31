import { EventEmitter } from 'events';
import { ExchangeCommand } from '../events/commands';
import { ExchangeEvent } from '../events/types';
import { MatchingEngine } from './matching-engine';
import { IJournal } from '../journal/types';
import { SettlementEngine } from '../db/settlement';
import { withTransaction } from '../db/db';
import { ticksAndLotsToQuoteUnits, lotsToBaseUnits } from '../utils/math';
import { MARKETS } from '../config';
import { logger } from '../logger';

export class ExchangeProcessor extends EventEmitter {
  private processing = false;
  private queue: Array<{
    cmd: ExchangeCommand;
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }> = [];

  private clientOrderCache = new Map<string, ExchangeEvent[]>();

  constructor(
    public engine: MatchingEngine,
    private journal: IJournal,
    private settlement: SettlementEngine
  ) {
    super();
  }

  public async submitCommand(cmd: ExchangeCommand): Promise<ExchangeEvent[]> {
    if (cmd.type === 'PLACE_ORDER' && this.clientOrderCache.has(cmd.clientOrderId)) {
      return this.clientOrderCache.get(cmd.clientOrderId)!;
    }
    
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, resolve, reject });
      this.pump();
    });
  }

  public async syncSettlement(): Promise<void> {
    const journalEvents: ExchangeEvent[] = [];
    for await (const event of this.journal.readFrom(0n)) {
      journalEvents.push(event);
    }
    
    // Populate clientOrderCache for idempotency after crash in O(N)
    const orderIdToClientOrderId = new Map<string, string>();
    for (const event of journalEvents) {
      if (event.type === 'ORDER_ACCEPTED' && (event as any).clientOrderId) {
        orderIdToClientOrderId.set((event as any).orderId, (event as any).clientOrderId);
      }
    }

    for (const event of journalEvents) {
      let clientOrderId: string | undefined = undefined;
      
      if (event.type === 'ORDER_ACCEPTED') {
        clientOrderId = (event as any).clientOrderId;
      } else if (event.type === 'TRADE_EXECUTED') {
        // A trade affects both maker and taker. For strict idempotency of API response,
        // we'd cache it for BOTH clientOrderIds if they exist.
        const e = event as any;
        const makerClientId = orderIdToClientOrderId.get(e.makerOrderId);
        const takerClientId = orderIdToClientOrderId.get(e.takerOrderId);
        if (makerClientId) {
          if (!this.clientOrderCache.has(makerClientId)) this.clientOrderCache.set(makerClientId, []);
          this.clientOrderCache.get(makerClientId)!.push(event);
        }
        if (takerClientId) {
          if (!this.clientOrderCache.has(takerClientId)) this.clientOrderCache.set(takerClientId, []);
          this.clientOrderCache.get(takerClientId)!.push(event);
        }
        continue; // handled both
      } else {
        const orderId = (event as any).orderId;
        if (orderId) clientOrderId = orderIdToClientOrderId.get(orderId);
      }

      if (clientOrderId) {
        if (!this.clientOrderCache.has(clientOrderId)) {
          this.clientOrderCache.set(clientOrderId, []);
        }
        this.clientOrderCache.get(clientOrderId)!.push(event);
      }
    }
    
    if (journalEvents.length === 0) return;

    await withTransaction(async (client) => {
      // Find events already settled
      const eventIds = journalEvents.map(e => e.eventId);
      const res = await client.query(
        `SELECT event_id FROM settlement_events WHERE event_id = ANY($1)`,
        [eventIds]
      );
      
      const settledSet = new Set(res.rows.map(r => r.event_id));
      
      const pendingEvents = journalEvents.filter(e => {
        // Only TRADE_EXECUTED, ORDER_ACCEPTED, ORDER_CANCELLED have settlement effects in our model
        const hasFinancialEffect = ['ORDER_ACCEPTED', 'TRADE_EXECUTED', 'ORDER_CANCELLED'].includes(e.type);
        return hasFinancialEffect && !settledSet.has(e.eventId);
      });

      if (pendingEvents.length > 0) {
        logger.info(`[syncSettlement] Catching up ${pendingEvents.length} unsettled financial events`);
        await this.settlement.settleEventsWithClient(client, pendingEvents);
      }
    });
  }

  private async pump() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const { cmd, resolve, reject } = this.queue.shift()!;
      try {
        const events = await this.executePipeline(cmd);
        this.emit('events', events);
        resolve(events);
      } catch (err) {
        reject(err);
      }
    }
    this.processing = false;
  }

  private async executePipeline(cmd: ExchangeCommand): Promise<ExchangeEvent[]> {
    // Pipeline: Risk -> Match -> Journal -> Settle -> Response
    // To guarantee consistency and avoid funds being permanently locked if the journal fails,
    // we wrap Risk and Settle in a single database transaction. 
    // The MatchingEngine remains pure and deterministic.

    return await withTransaction(async (client) => {
      // 1. Risk Check & Lock
      if (cmd.type === 'PLACE_ORDER') {
        const mkt = MARKETS.find(m => m.symbol === cmd.market)!;
        let requiredAsset = '';
        let requiredAmount = 0n;

        const baseMultiplier = BigInt(Math.round(mkt.lotSize * 1e8));
        const quoteMultiplier = BigInt(Math.round(mkt.lotSize * mkt.tickSize * 1e8));

        if (cmd.side === 'buy') {
          requiredAsset = mkt.quoteAsset;
          if (cmd.orderType === 'market') {
            const qtyLots = cmd.quantityLots;
            const q = this.engine.getQuote(cmd.market, 'buy', qtyLots);
            if (!q) throw new Error('INSUFFICIENT_LIQUIDITY');
            
            const bufferedTicks = Math.ceil(q.totalCostTicks * 1.05);
            requiredAmount = BigInt(bufferedTicks) * quoteMultiplier;
          } else {
            const quote = BigInt(cmd.priceTicks) * BigInt(cmd.quantityLots) * quoteMultiplier;
            const fee = quote / 1000n; // 0.1%
            requiredAmount = quote + fee;
          }
        } else {
          requiredAsset = mkt.baseAsset;
          requiredAmount = BigInt(cmd.quantityLots) * baseMultiplier;
        }

        // Risk Check: verify balance exists, lock row to prevent concurrent withdrawals
        const res = await client.query(
          `SELECT available_units FROM accounts 
           WHERE user_id = $1 AND asset = $2 FOR UPDATE`,
          [cmd.userId, requiredAsset]
        );

        if (res.rowCount === 0) {
          throw new Error('Account not found');
        }

        const available = BigInt(res.rows[0].available_units);
        if (available < requiredAmount) {
          throw new Error('INSUFFICIENT_BALANCE');
        }
      }

      // 2. Match (Deterministic, In-Memory)
      const events = this.engine.processCommand(cmd);

      // 3. Journal Append
      try {
        await this.journal.appendBatch(events);
        await this.journal.flush();
      } catch (err) {
        // If Journal fails (e.g. out of disk space), we MUST panic.
        // We throw an error, which rolls back the DB transaction (Risk lock).
        // Since it's a panic boundary, we can also choose to process.exit(1), 
        // but throwing here gracefully rolls back DB state and rejects the API request.
        logger.error({ err }, 'FATAL: Journal append failed!');
        throw err; 
      }

      // 4. Settlement
      await this.settlement.settleEventsWithClient(client, events);
      logger.info(`SETTLEMENT_SUCCEEDED: Successfully settled ${events.length} events (including ORDER_ACCEPTED / TRADE_EXECUTED)`);

      // Cache for idempotency
      if (cmd.type === 'PLACE_ORDER' && cmd.clientOrderId) {
        this.clientOrderCache.set(cmd.clientOrderId, events);
      }

      return events;
    });
  }
}
