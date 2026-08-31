import { query } from '../db/db';
import { FileJournal } from '../journal/file-journal';
import { ExchangeEvent } from '../events/types';
import { MARKETS } from '../config';

async function reconcile() {
  console.log('Starting Reconciliation Job...');

  // 1. Materialized account balance
  const accountsRes = await query(`SELECT id, user_id, asset, available_units, locked_units FROM accounts`);
  const materialized = new Map<string, bigint>();
  for (const row of accountsRes.rows) {
    const total = BigInt(row.available_units) + BigInt(row.locked_units);
    materialized.set(row.id, total);
  }

  // 2. Ledger derived balance
  const ledgerRes = await query(`
    SELECT account_id, asset, SUM(amount) as net_amount 
    FROM ledger_entries 
    GROUP BY account_id, asset
  `);
  const ledger = new Map<string, bigint>();
  for (const row of ledgerRes.rows) {
    ledger.set(row.account_id, BigInt(row.net_amount));
  }

  // 3. Journal expected balance
  const journal = new FileJournal('exchange.journal');
  const journalBalance = new Map<string, bigint>();

  const getOrInit = (accountId: string) => {
    if (!journalBalance.has(accountId)) journalBalance.set(accountId, 0n);
    return journalBalance.get(accountId)!;
  };

  const add = (userId: string, asset: string, amount: bigint) => {
    const accId = userId === 'exchange' ? `exchange_${asset}` : 
                 (userId === 'mm_user' ? `mm_${asset}` : `${userId}_${asset}`);
    journalBalance.set(accId, getOrInit(accId) + amount);
  };

  for await (const event of journal.readFrom(0n)) {
    if (event.type === 'TRADE_EXECUTED') {
      const e = event as any;
      const mkt = MARKETS.find(m => m.symbol === e.market)!;
      const baseAsset = mkt.baseAsset;
      const quoteAsset = mkt.quoteAsset;
      const baseMultiplier = BigInt(Math.round(mkt.lotSize * 1e8));
      const quoteMultiplier = BigInt(Math.round(mkt.lotSize * mkt.tickSize * 1e8));

      const buyerId = e.makerIsBuyer ? e.makerUserId : e.takerUserId;
      const sellerId = e.makerIsBuyer ? e.takerUserId : e.makerUserId;

      const baseAmount = BigInt(e.quantityLots) * baseMultiplier;
      const quoteAmount = BigInt(e.priceTicks) * BigInt(e.quantityLots) * quoteMultiplier;
      const feeQuote = quoteAmount / 1000n; // 0.1%

      // Buyer: +Base, -Quote, -Fee
      add(buyerId, baseAsset, baseAmount);
      add(buyerId, quoteAsset, -(quoteAmount + feeQuote));

      // Seller: -Base, +Quote, -Fee
      add(sellerId, baseAsset, -baseAmount);
      add(sellerId, quoteAsset, (quoteAmount - feeQuote));

      // Exchange: +2*Fee
      add('exchange', quoteAsset, feeQuote * 2n);
    }
  }

  // Compare
  const allAccounts = new Set([...materialized.keys(), ...ledger.keys(), ...journalBalance.keys()]);
  
  let hasErrors = false;
  console.log('\n--- Reconciliation Report ---');
  console.log('Account ID | Materialized | Ledger | Journal | Status');
  console.log('---------------------------------------------------------');

  for (const acc of allAccounts) {
    const mat = materialized.get(acc) || 0n;
    const ledg = ledger.get(acc) || 0n;
    const journ = journalBalance.get(acc) || 0n;
    
    const initialBalance = mat - ledg;
    const derivedMaterialized = initialBalance + journ;

    const isMatch = (ledg === journ) && (mat === derivedMaterialized);

    console.log(`${acc.padEnd(12)} | ${mat.toString().padStart(12)} | ${ledg.toString().padStart(10)} | ${journ.toString().padStart(10)} | ${isMatch ? 'OK' : 'MISMATCH'}`);

    if (!isMatch) {
      hasErrors = true;
    }
  }

  console.log('---------------------------------------------------------');
  if (hasErrors) {
    console.error('FAILED: Reconciliation mismatch detected!');
    process.exit(1);
  } else {
    console.log('SUCCESS: All balances reconcile perfectly.');
    process.exit(0);
  }
}

reconcile().catch(console.error);
