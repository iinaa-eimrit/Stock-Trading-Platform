import { describe, it, expect, beforeEach } from 'vitest';
import { RiskEngine } from './risk-engine';
import { InMemorySettlementStore } from '../accounting/in-memory-store';
import { MarketConfig } from '../config';

describe('RiskEngine', () => {
  let store: InMemorySettlementStore;
  let risk: RiskEngine;

  beforeEach(() => {
    store = new InMemorySettlementStore();
    const markets = new Map<string, MarketConfig>();
    markets.set('ETH_USDC', { symbol: 'ETH_USDC', baseAsset: 'ETH', quoteAsset: 'USDC', tickSize: 0.01, lotSize: 0.001, minNotional: 1 });
    risk = new RiskEngine(store, markets);
  });

  it('rejects invalid markets', () => {
    const res = risk.validateOrder({ userId: 'u1', market: 'INVALID', side: 'buy', type: 'limit', priceTicks: 100, quantityLots: 1 });
    expect(res).toEqual({ status: 'rejected', reason: 'INVALID_MARKET' });
  });

  it('rejects invalid quantities and prices', () => {
    let res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'buy', type: 'limit', priceTicks: 100, quantityLots: -1 });
    expect(res).toEqual({ status: 'rejected', reason: 'INVALID_QUANTITY' });

    res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'buy', type: 'limit', priceTicks: 0, quantityLots: 1 });
    expect(res).toEqual({ status: 'rejected', reason: 'INVALID_PRICE' });
  });

  const UNIT = 100_000_000;

  it('rejects orders exceeding max quantity', () => {
    // 2,000,000,000 lots * 0.001 = 2,000,000 base units > 1,000,000 limit
    const res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'buy', type: 'limit', priceTicks: 100, quantityLots: 2_000_000_000 });
    expect(res).toEqual({ status: 'rejected', reason: 'MAX_ORDER_QUANTITY' });
  });

  it('rejects orders exceeding max notional', () => {
    // 1,000,000 priceTicks * 1,001,000 quantityLots = 1,001,000,000,000 Ticks*Lots
    // Multiplier = 1000. So QuoteUnits = 1,001,000,000,000,000 > 10M * 1e8 (1,000,000,000,000,000)
    const res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'buy', type: 'limit', priceTicks: 1_000_000, quantityLots: 1_001_000 });
    expect(res).toEqual({ status: 'rejected', reason: 'MAX_NOTIONAL' });
  });

  it('rejects buy limit order with insufficient quote balance', () => {
    store.deposit('u1', 'USDC', 0.5 * UNIT); 
    const res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'buy', type: 'limit', priceTicks: 100, quantityLots: 1000 });
    expect(res).toEqual({ status: 'rejected', reason: 'INSUFFICIENT_BALANCE' });
  });

  it('approves valid buy limit order', () => {
    store.deposit('u1', 'USDC', 10 * UNIT);
    const res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'buy', type: 'limit', priceTicks: 100, quantityLots: 1000 });
    expect(res).toEqual({ status: 'approved' });
  });

  it('rejects sell limit order with insufficient base balance', () => {
    store.deposit('u1', 'ETH', 0.5 * UNIT); // quantityLots: 1000 -> 1 ETH
    const res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'sell', type: 'limit', priceTicks: 100, quantityLots: 1000 });
    expect(res).toEqual({ status: 'rejected', reason: 'INSUFFICIENT_BALANCE' });
  });

  it('approves valid sell limit order', () => {
    store.deposit('u1', 'ETH', 1 * UNIT);
    const res = risk.validateOrder({ userId: 'u1', market: 'ETH_USDC', side: 'sell', type: 'limit', priceTicks: 100, quantityLots: 1000 });
    expect(res).toEqual({ status: 'approved' });
  });
});
