import { PoolClient } from 'pg';
import { ExchangeEvent, TradeExecutedEvent, OrderCancelledEvent } from '../events/types';
import { withTransaction } from './db';
import { v4 as uuidv4 } from 'uuid';

export class SettlementEngine {
  
  /**
   * Idempotently process a batch of events inside a single transaction.
   * This is useful for synchronous processing of all events from a single command.
   */
  public async settleEvents(events: ExchangeEvent[]): Promise<void> {
    if (events.length === 0) return;

    await withTransaction(async (client) => {
      await this.settleEventsWithClient(client, events);
    });
  }

  public async settleEventsWithClient(client: PoolClient, events: ExchangeEvent[]): Promise<void> {
    if (events.length === 0) return;
    
    // Sort events to process ACCEPTED first, then TRADES, then CANCELLED
    const sortedEvents = [...events].sort((a, b) => {
      const order = { 'ORDER_ACCEPTED': 1, 'TRADE_EXECUTED': 2, 'ORDER_CANCELLED': 3 };
      return (order[a.type as keyof typeof order] || 4) - (order[b.type as keyof typeof order] || 4);
    });

    for (const event of sortedEvents) {
      if (event.type === 'ORDER_ACCEPTED') {
        await this.settleAccepted(client, event as any);
      } else if (event.type === 'TRADE_EXECUTED') {
        await this.settleTrade(client, event as TradeExecutedEvent);
      } else if (event.type === 'ORDER_CANCELLED') {
        await this.settleCancel(client, event as OrderCancelledEvent);
      }
    }
  }

  private async settleAccepted(client: PoolClient, event: any): Promise<void> {
    const checkRes = await client.query(
      `INSERT INTO settlement_events (event_id, exchange_sequence, event_type, status)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.eventId, event.sequenceNumber, event.type, 'SETTLED']
    );
    if (checkRes.rowCount === 0) return;

    // Lock funds for the order
    const MARKETS = [
      { symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.0001, baseAsset: 'ETH', quoteAsset: 'USDC' },
      { symbol: 'BTC_USDC', tickSize: 0.1, lotSize: 0.00001, baseAsset: 'BTC', quoteAsset: 'USDC' },
      { symbol: 'SOL_USDC', tickSize: 0.001, lotSize: 0.01, baseAsset: 'SOL', quoteAsset: 'USDC' }
    ];
    const mkt = MARKETS.find(m => m.symbol === event.market)!;
    
    // lotSize/tickSize to integer units
    const baseMultiplier = BigInt(Math.round(mkt.lotSize * 1e8));
    const quoteMultiplier = BigInt(Math.round(mkt.lotSize * mkt.tickSize * 1e8));

    let requiredAsset = '';
    let requiredAmount = 0n;

    if (event.side === 'buy') {
      requiredAsset = mkt.quoteAsset;
      if (event.orderType === 'market') {
        // Market orders fill immediately. Lock 0.
        requiredAmount = 0n; 
      } else {
        // Calculate quote amount + 0.1% fee
        const quote = BigInt(event.priceTicks) * BigInt(event.quantityLots) * quoteMultiplier;
        const fee = quote / 1000n; // 0.1%
        requiredAmount = quote + fee;
      }
    } else {
      requiredAsset = mkt.baseAsset;
      requiredAmount = BigInt(event.quantityLots) * baseMultiplier;
    }

    if (requiredAmount > 0n) {
      const res = await client.query(
        `UPDATE accounts 
         SET available_units = available_units - $1, locked_units = locked_units + $1 
         WHERE user_id = $2 AND asset = $3 AND available_units >= $1
         RETURNING id`,
        [requiredAmount.toString(), event.userId, requiredAsset]
      );
      if (res.rowCount === 0) {
        throw new Error(`Insufficient balance for ORDER_ACCEPTED (user: ${event.userId})`);
      }
    }
  }

  private async settleTrade(client: PoolClient, event: TradeExecutedEvent): Promise<void> {
    const checkRes = await client.query(
      `INSERT INTO settlement_events (event_id, exchange_sequence, event_type, status)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.eventId, event.sequenceNumber, event.type, 'SETTLED']
    );
    if (checkRes.rowCount === 0) return;

    await client.query(
      `INSERT INTO trades (trade_id, exchange_event_id, market, buyer_id, seller_id, price_ticks, quantity_lots)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [event.tradeId, event.eventId, event.market, event.makerIsBuyer ? event.makerUserId : event.takerUserId, event.makerIsBuyer ? event.takerUserId : event.makerUserId, event.priceTicks, event.quantityLots]
    );

    const buyerId = event.makerIsBuyer ? event.makerUserId : event.takerUserId;
    const sellerId = event.makerIsBuyer ? event.takerUserId : event.makerUserId;
    const exchangeId = 'exchange';
    
    const accountUserIds = Array.from(new Set([buyerId, sellerId, exchangeId])).sort();
    const [baseAsset, quoteAsset] = event.market.split('_');
    
    const accountsRes = await client.query(
      `SELECT id, user_id, asset, available_units, locked_units FROM accounts 
       WHERE user_id = ANY($1) AND asset = ANY($2) ORDER BY user_id ASC, asset ASC FOR UPDATE`,
      [accountUserIds, [baseAsset, quoteAsset]]
    );

    const accountMap = new Map<string, Map<string, any>>();
    for (const row of accountsRes.rows) {
      if (!accountMap.has(row.user_id)) accountMap.set(row.user_id, new Map());
      accountMap.get(row.user_id)!.set(row.asset, row);
    }

    const getAccount = (userId: string, asset: string) => accountMap.get(userId)?.get(asset);

    // Let's get the market config to compute real units
    const MARKETS = [
      { symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.0001, baseAsset: 'ETH', quoteAsset: 'USDC' },
      { symbol: 'BTC_USDC', tickSize: 0.1, lotSize: 0.00001, baseAsset: 'BTC', quoteAsset: 'USDC' },
      { symbol: 'SOL_USDC', tickSize: 0.001, lotSize: 0.01, baseAsset: 'SOL', quoteAsset: 'USDC' }
    ];
    const mkt = MARKETS.find(m => m.symbol === event.market)!;
    
    // lotSize/tickSize to integer units
    const baseMultiplier = BigInt(Math.round(mkt.lotSize * 1e8));
    const quoteMultiplier = BigInt(Math.round(mkt.lotSize * mkt.tickSize * 1e8));

    const baseAmount = BigInt(event.quantityLots) * baseMultiplier;
    const quoteAmount = BigInt(event.priceTicks) * BigInt(event.quantityLots) * quoteMultiplier;
    
    const feeQuote = quoteAmount / 1000n; // 0.1%

    const buyerQuoteAcc = getAccount(buyerId, quoteAsset);
    const buyerBaseAcc = getAccount(buyerId, baseAsset);
    const sellerQuoteAcc = getAccount(sellerId, quoteAsset);
    const sellerBaseAcc = getAccount(sellerId, baseAsset);
    const exchangeQuoteAcc = getAccount(exchangeId, quoteAsset);

    if (!buyerQuoteAcc || !buyerBaseAcc || !sellerQuoteAcc || !sellerBaseAcc || !exchangeQuoteAcc) {
      throw new Error('Missing accounts during settlement');
    }

    // Buyer gets Base, pays Quote + Fee
    await client.query(`UPDATE accounts SET available_units = available_units + $1 WHERE id = $2`, [baseAmount.toString(), buyerBaseAcc.id]);
    
    // We try deducting from locked first, if insufficient (e.g. Market order), deduct remainder from available
    const totalBuyerCost = quoteAmount + feeQuote;
    await client.query(`
      UPDATE accounts SET 
        locked_units = CASE WHEN locked_units >= $1 THEN locked_units - $1 ELSE 0 END,
        available_units = CASE WHEN locked_units < $1 THEN available_units - ($1 - locked_units) ELSE available_units END
      WHERE id = $2`, [totalBuyerCost.toString(), buyerQuoteAcc.id]);

    // Seller gets Quote - Fee, pays Base
    await client.query(`UPDATE accounts SET available_units = available_units + $1 WHERE id = $2`, [(quoteAmount - feeQuote).toString(), sellerQuoteAcc.id]);
    
    await client.query(`
      UPDATE accounts SET 
        locked_units = CASE WHEN locked_units >= $1 THEN locked_units - $1 ELSE 0 END,
        available_units = CASE WHEN locked_units < $1 THEN available_units - ($1 - locked_units) ELSE available_units END
      WHERE id = $2`, [baseAmount.toString(), sellerBaseAcc.id]);

    // Exchange gets Fees
    await client.query(`UPDATE accounts SET available_units = available_units + $1 WHERE id = $2`, [(feeQuote * 2n).toString(), exchangeQuoteAcc.id]);

    const txId = uuidv4();
    await client.query(`INSERT INTO ledger_transactions (id, event_id) VALUES ($1, $2)`, [txId, event.eventId]);
    
    const quoteEntries = [
      { acc: buyerQuoteAcc.id, amt: -(quoteAmount + feeQuote) },
      { acc: sellerQuoteAcc.id, amt: (quoteAmount - feeQuote) },
      { acc: exchangeQuoteAcc.id, amt: (feeQuote * 2n) }
    ];
    for (const entry of quoteEntries) {
      await client.query(`INSERT INTO ledger_entries (id, transaction_id, account_id, asset, amount) VALUES ($1, $2, $3, $4, $5)`, [uuidv4(), txId, entry.acc, quoteAsset, entry.amt.toString()]);
    }

    const baseEntries = [
      { acc: buyerBaseAcc.id, amt: baseAmount },
      { acc: sellerBaseAcc.id, amt: -baseAmount }
    ];
    for (const entry of baseEntries) {
      await client.query(`INSERT INTO ledger_entries (id, transaction_id, account_id, asset, amount) VALUES ($1, $2, $3, $4, $5)`, [uuidv4(), txId, entry.acc, baseAsset, entry.amt.toString()]);
    }
  }

  private async settleCancel(client: PoolClient, event: OrderCancelledEvent): Promise<void> {
    const checkRes = await client.query(
      `INSERT INTO settlement_events (event_id, exchange_sequence, event_type, status)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.eventId, event.sequenceNumber, event.type, 'SETTLED']
    );
    if (checkRes.rowCount === 0) return;

    const MARKETS = [
      { symbol: 'ETH_USDC', tickSize: 0.01, lotSize: 0.0001, baseAsset: 'ETH', quoteAsset: 'USDC' },
      { symbol: 'BTC_USDC', tickSize: 0.1, lotSize: 0.00001, baseAsset: 'BTC', quoteAsset: 'USDC' },
      { symbol: 'SOL_USDC', tickSize: 0.001, lotSize: 0.01, baseAsset: 'SOL', quoteAsset: 'USDC' }
    ];
    const mkt = MARKETS.find(m => m.symbol === event.market)!;
    
    // lotSize/tickSize to integer units
    const baseMultiplier = BigInt(Math.round(mkt.lotSize * 1e8));
    const quoteMultiplier = BigInt(Math.round(mkt.lotSize * mkt.tickSize * 1e8));

    let refundAsset = '';
    let refundAmount = 0n;

    if (event.side === 'buy') {
      refundAsset = mkt.quoteAsset;
      if (event.priceTicks === 0) {
        // Market orders fill immediately and don't lock anything.
        refundAmount = 0n; 
      } else {
        const quote = BigInt(event.priceTicks) * BigInt(event.remainingLots) * quoteMultiplier;
        const fee = quote / 1000n; // 0.1%
        refundAmount = quote + fee;
      }
    } else {
      refundAsset = mkt.baseAsset;
      refundAmount = BigInt(event.remainingLots) * baseMultiplier;
    }

    if (refundAmount > 0n) {
      await client.query(
        `UPDATE accounts 
         SET available_units = available_units + $1, locked_units = locked_units - $1 
         WHERE user_id = $2 AND asset = $3`,
        [refundAmount.toString(), event.userId, refundAsset]
      );
    }
  }
}
