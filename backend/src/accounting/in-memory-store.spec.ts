import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySettlementStore } from './in-memory-store';

describe('InMemorySettlementStore (Accounting Invariants)', () => {
  let store: InMemorySettlementStore;

  beforeEach(() => {
    store = new InMemorySettlementStore();
  });

  const expectInvariant = (userId: string, asset: string) => {
    const bal = store.getBalance(userId, asset);
    expect(bal.available + bal.locked).toBe(bal.total);
  };

  it('maintains available + locked = total during reservation and release', () => {
    store.deposit('u1', 'USD', 1000);
    expectInvariant('u1', 'USD');
    expect(store.getBalance('u1', 'USD').available).toBe(1000);

    const reserved = store.reserve('u1', 'USD', 400);
    expect(reserved).toBe(true);
    expectInvariant('u1', 'USD');
    expect(store.getBalance('u1', 'USD').available).toBe(600);
    expect(store.getBalance('u1', 'USD').locked).toBe(400);

    store.release('u1', 'USD', 100);
    expectInvariant('u1', 'USD');
    expect(store.getBalance('u1', 'USD').available).toBe(700);
    expect(store.getBalance('u1', 'USD').locked).toBe(300);
  });

  it('maintains global supply invariant during settlement', () => {
    store.deposit('buyer', 'USD', 2000);
    store.deposit('seller', 'ETH', 10);

    const initialTotalUsd = store.getBalance('buyer', 'USD').total + store.getBalance('seller', 'USD').total;
    const initialTotalEth = store.getBalance('buyer', 'ETH').total + store.getBalance('seller', 'ETH').total;

    // To settle, funds must be locked first
    store.reserve('buyer', 'USD', 1500); // 10 ETH * $150
    store.reserve('seller', 'ETH', 10);

    // Trade executes: 10 ETH @ $150
    store.settle('buyer', 'seller', 'ETH', 'USD', 10, 1500);

    // Verify individual constraints
    expectInvariant('buyer', 'USD');
    expectInvariant('seller', 'USD');
    expectInvariant('buyer', 'ETH');
    expectInvariant('seller', 'ETH');

    // Verify buyer received ETH and paid USD
    expect(store.getBalance('buyer', 'ETH').total).toBe(10);
    expect(store.getBalance('buyer', 'USD').total).toBe(500);

    // Verify seller received USD and paid ETH
    expect(store.getBalance('seller', 'USD').total).toBe(1500);
    expect(store.getBalance('seller', 'ETH').total).toBe(0);

    // Verify global invariant
    const finalTotalUsd = store.getBalance('buyer', 'USD').total + store.getBalance('seller', 'USD').total;
    const finalTotalEth = store.getBalance('buyer', 'ETH').total + store.getBalance('seller', 'ETH').total;

    expect(finalTotalUsd).toBe(initialTotalUsd);
    expect(finalTotalEth).toBe(initialTotalEth);
  });

  it('rejects settlement if funds are not reserved', () => {
    store.deposit('buyer', 'USD', 2000);
    store.deposit('seller', 'ETH', 10);

    // Did not reserve funds
    expect(() => {
      store.settle('buyer', 'seller', 'ETH', 'USD', 10, 1500);
    }).toThrow('Buyer does not have enough locked quote asset');
  });

  it('correctly deducts and credits fees to the exchange account', () => {
    store.deposit('buyer', 'USD', 2000);
    store.deposit('seller', 'ETH', 10);

    store.reserve('buyer', 'USD', 1500); // 10 ETH * $150
    store.reserve('seller', 'ETH', 10);

    const buyerFeeBase = 0.01; // 0.1% of 10 ETH
    const sellerFeeQuote = 1.5; // 0.1% of 1500 USD

    store.settle('buyer', 'seller', 'ETH', 'USD', 10, 1500, buyerFeeBase, sellerFeeQuote);

    // Buyer receives 10 - 0.01 = 9.99 ETH
    expect(store.getBalance('buyer', 'ETH').total).toBe(9.99);
    expect(store.getBalance('buyer', 'ETH').available).toBe(9.99);

    // Seller receives 1500 - 1.5 = 1498.5 USD
    expect(store.getBalance('seller', 'USD').total).toBe(1498.5);
    expect(store.getBalance('seller', 'USD').available).toBe(1498.5);

    // Exchange receives 0.01 ETH and 1.5 USD
    expect(store.getBalance('EXCHANGE', 'ETH').total).toBe(0.01);
    expect(store.getBalance('EXCHANGE', 'USD').total).toBe(1.5);
  });
});
