import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { query, getClient } from './db';
import { SettlementEngine } from './settlement';
import { TradeExecutedEvent } from '../events/types';
import { v4 as uuidv4 } from 'uuid';

describe('SettlementEngine PostgreSQL Tests', () => {
  const engine = new SettlementEngine();

  beforeAll(async () => {
    // Make sure test users and accounts exist
    await query(`INSERT INTO users (id) VALUES ('buyer_1'), ('seller_1'), ('exchange') ON CONFLICT DO NOTHING`);
    await query(`
      INSERT INTO accounts (id, user_id, asset, available_units) VALUES 
      ('acc_b_quote', 'buyer_1', 'USDC', 100000000),
      ('acc_b_base', 'buyer_1', 'ETH', 0),
      ('acc_s_quote', 'seller_1', 'USDC', 0),
      ('acc_s_base', 'seller_1', 'ETH', 1000000),
      ('acc_e_quote', 'exchange', 'USDC', 0),
      ('acc_e_base', 'exchange', 'ETH', 0)
      ON CONFLICT DO NOTHING
    `);
  });

  beforeEach(async () => {
    // Reset balances before each test
    await query(`UPDATE accounts SET available_units = 100000000 WHERE user_id = 'buyer_1' AND asset = 'USDC'`);
    await query(`UPDATE accounts SET available_units = 0 WHERE user_id = 'buyer_1' AND asset = 'ETH'`);
    
    await query(`UPDATE accounts SET available_units = 0 WHERE user_id = 'seller_1' AND asset = 'USDC'`);
    await query(`UPDATE accounts SET available_units = 1000000 WHERE user_id = 'seller_1' AND asset = 'ETH'`);
    
    await query(`UPDATE accounts SET available_units = 0 WHERE user_id = 'exchange' AND asset = 'USDC'`);
    
    await query(`DELETE FROM ledger_entries`);
    await query(`DELETE FROM ledger_transactions`);
    await query(`DELETE FROM trades`);
    await query(`DELETE FROM settlement_events`);
  });

  afterAll(async () => {
    await query(`DELETE FROM ledger_entries`);
    await query(`DELETE FROM ledger_transactions`);
    await query(`DELETE FROM trades`);
    await query(`DELETE FROM settlement_events`);
  });

  const createTradeEvent = (seq: bigint = 1n): TradeExecutedEvent => ({
    type: 'TRADE_EXECUTED',
    eventId: uuidv4(),
    sequenceNumber: seq,
    timestamp: Date.now(),
    market: 'ETH_USDC',
    tradeId: uuidv4(),
    makerOrderId: uuidv4(),
    takerOrderId: uuidv4(),
    makerUserId: 'seller_1',
    takerUserId: 'buyer_1',
    makerIsBuyer: false,
    priceTicks: 2000,
    quantityLots: 10
  });

  it('Test A - Normal settlement', async () => {
    const event = createTradeEvent();
    await engine.settleEvents([event]);

    // Verify trades table
    const trades = await query(`SELECT * FROM trades`);
    expect(trades.rowCount).toBe(1);

    // Verify balances:
    // Buyer bought 10 ETH at 2000 USDC. 
    // quoteAmount = 2000 * 10 * 100 = 2000000. fee = 2000. Total = 2002000
    // Buyer pays 2002000 USDC, gets 10 ETH (baseAmount = 10 * 10000 = 100000)
    const buyerQuote = await query(`SELECT available_units FROM accounts WHERE user_id = 'buyer_1' AND asset = 'USDC'`);
    expect(Number(buyerQuote.rows[0].available_units)).toBe(100000000 - 2002000);

    const buyerBase = await query(`SELECT available_units FROM accounts WHERE user_id = 'buyer_1' AND asset = 'ETH'`);
    expect(Number(buyerBase.rows[0].available_units)).toBe(100000);

    // Seller gets 2000000 - 2000 fee = 1998000 USDC, pays 10 ETH (100000 units).
    const sellerQuote = await query(`SELECT available_units FROM accounts WHERE user_id = 'seller_1' AND asset = 'USDC'`);
    expect(Number(sellerQuote.rows[0].available_units)).toBe(1998000);

    const sellerBase = await query(`SELECT available_units FROM accounts WHERE user_id = 'seller_1' AND asset = 'ETH'`);
    expect(Number(sellerBase.rows[0].available_units)).toBe(1000000 - 100000);

    // Exchange gets 4000 USDC fee.
    const exQuote = await query(`SELECT available_units FROM accounts WHERE user_id = 'exchange' AND asset = 'USDC'`);
    expect(Number(exQuote.rows[0].available_units)).toBe(4000);

    // Verify ledger sum = 0
    const ledgerSum = await query(`SELECT asset, SUM(amount) as total FROM ledger_entries GROUP BY asset`);
    for (const row of ledgerSum.rows) {
      expect(Number(row.total)).toBe(0);
    }
  });

  it('Test B - Duplicate event', async () => {
    const event = createTradeEvent();
    
    // Process twice
    await engine.settleEvents([event]);
    await engine.settleEvents([event]);

    // Should only have 1 trade
    const trades = await query(`SELECT * FROM trades`);
    expect(trades.rowCount).toBe(1);

    // Ledger should only have 1 transaction
    const txs = await query(`SELECT * FROM ledger_transactions`);
    expect(txs.rowCount).toBe(1);
  });

  it('Test C - Crash before commit', async () => {
    const event = createTradeEvent();
    
    const client = await getClient();
    try {
      await client.query('BEGIN');
      // Simulate settling but we rollback
      await engine['settleTrade'](client, event);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Nothing should be saved
    const trades = await query(`SELECT * FROM trades`);
    expect(trades.rowCount).toBe(0);

    // Now retry normally
    await engine.settleEvents([event]);
    const tradesAfter = await query(`SELECT * FROM trades`);
    expect(tradesAfter.rowCount).toBe(1);
  });

  it('Test D - Crash after commit (Idempotency catches it on retry)', async () => {
    const event = createTradeEvent();
    // Simulate first successful run
    await engine.settleEvents([event]);
    
    // Simulate crash and retry
    await engine.settleEvents([event]);
    
    const trades = await query(`SELECT * FROM trades`);
    expect(trades.rowCount).toBe(1);
  });

  it('Test E - Insufficient balance', async () => {
    const event = createTradeEvent();
    event.quantityLots = 10000000; // Requires more ETH and USDC than available

    await expect(engine.settleEvents([event])).rejects.toThrow(/violates check constraint "accounts_available_positive"/);

    // Entire transaction rolls back
    const trades = await query(`SELECT * FROM trades`);
    expect(trades.rowCount).toBe(0);
    
    const ledger = await query(`SELECT * FROM ledger_transactions`);
    expect(ledger.rowCount).toBe(0);
  });

  it('Test F - Concurrent settlement', async () => {
    const event = createTradeEvent();
    
    // Race two promises
    await Promise.all([
      engine.settleEvents([event]),
      engine.settleEvents([event])
    ]);

    const trades = await query(`SELECT * FROM trades`);
    expect(trades.rowCount).toBe(1);
    
    const ledger = await query(`SELECT * FROM ledger_transactions`);
    expect(ledger.rowCount).toBe(1);
  });
});
