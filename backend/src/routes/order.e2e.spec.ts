import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../db/db';
import { createApp } from '../app';
import { JWT_SECRET } from '../config';

describe('Order API (End-to-End)', () => {
  let app: any;
  let tokenU1: string;
  let tokenU2: string;

  beforeAll(async () => {
    // Make sure we have clean accounts for u1 and u2
    await query(`DELETE FROM ledger_entries`);
    await query(`DELETE FROM ledger_transactions`);
    await query(`DELETE FROM trades`);
    await query(`DELETE FROM settlement_events`);
    await query(`DELETE FROM accounts WHERE user_id IN ('u1', 'u2', 'exchange')`);
    await query(`
      INSERT INTO users (id) VALUES ('u1'), ('u2'), ('exchange') ON CONFLICT DO NOTHING;
      INSERT INTO accounts (id, user_id, asset, available_units, locked_units) VALUES 
      ('u1_USDC', 'u1', 'USDC', 10000000000000, 0),
      ('u1_ETH', 'u1', 'ETH', 10000000000, 0),
      ('u2_USDC', 'u2', 'USDC', 10000000000000, 0),
      ('u2_ETH', 'u2', 'ETH', 10000000000, 0),
      ('exchange_USDC', 'exchange', 'USDC', 0, 0),
      ('exchange_ETH', 'exchange', 'ETH', 0, 0)
    `);
    const created = createApp();
    app = created.app;
    app.locals.isReady = true;
    tokenU1 = jwt.sign({ userId: 'u1' }, JWT_SECRET);
    tokenU2 = jwt.sign({ userId: 'u2' }, JWT_SECRET);
  });

  const placeOrder = async (token: string, payload: any) => {
    return request(app)
      .post('/api/v1/order')
      .set('Authorization', `Bearer ${token}`)
      .send(payload);
  };

  it('rejects unauthorized access', async () => {
    const res = await request(app).post('/api/v1/order').send({
      clientOrderId: 'auth_fail',
      market: 'ETH_USDC',
      side: 'buy',
      type: 'limit',
      price: 100,
      quantity: 1
    });
    expect(res.status).toBe(401);
  });

  it('handles successful limit order and idempotency (duplicate clientOrderId)', async () => {
    // 1. Initial successful order
    const payload = {
      clientOrderId: 'e2e_limit_1',
      market: 'ETH_USDC',
      side: 'buy',
      type: 'limit',
      price: 100,
      quantity: 1
    };
    const res = await placeOrder(tokenU1, payload);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('processed');

    // 2. Duplicate order (idempotency) - exact same clientOrderId
    const res2 = await placeOrder(tokenU1, payload);
    // Our idempotency logic correctly returns the original cached response
    expect(res2.status).toBe(200);
    expect(res2.body.data.orderId).toBeDefined();
  });

  it('rejects order with insufficient balance', async () => {
    const res = await placeOrder(tokenU1, {
      clientOrderId: 'e2e_insufficient',
      market: 'ETH_USDC',
      side: 'buy',
      type: 'limit',
      price: 2000,
      quantity: 100 // Costs 200,000 USDC, u1 only has 100K
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('prevents self-trading across the full API flow', async () => {
    // u1 already has a buy at 100 for 1 ETH
    // u1 tries to sell at 100 for 1 ETH -> should be cancelled
    const res = await placeOrder(tokenU1, {
      clientOrderId: 'e2e_stp_1',
      market: 'ETH_USDC',
      side: 'sell',
      type: 'limit',
      price: 100,
      quantity: 1
    });
    
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('processed');
    expect(res.body.data.trades).toHaveLength(0);
  });

  it('handles partial fill and fee settlement between two different users', async () => {
    // u1 has buy at 100 for 1 ETH resting.
    // u2 sells 0.5 ETH at 100.
    const res = await placeOrder(tokenU2, {
      clientOrderId: 'e2e_partial_1',
      market: 'ETH_USDC',
      side: 'sell',
      type: 'limit',
      price: 100,
      quantity: 0.5
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('processed'); // u2 sell is processed
    expect(res.body.data.trades).toHaveLength(1);
    
    const trade = res.body.data.trades[0];
    expect(trade.quantityLots).toBe(5000);
    expect(trade.priceTicks).toBe(10000);

    // Verify balances via API
    const bal1 = await request(app).get('/api/v1/balance').set('Authorization', `Bearer ${tokenU1}`);
    const bal2 = await request(app).get('/api/v1/balance').set('Authorization', `Bearer ${tokenU2}`);

    // u1 started with 100,000 USDC and 100 ETH
    // u1 bought 0.5 ETH at 100 = 50 USDC cost.
    // u1 should have 100,000 - 50 = 99,950 USDC.
    // Note: u1 still has 0.5 ETH resting, so 50 USDC is locked. 99,900 available.
    const UNIT = 100_000_000n;
    expect(bal1.body.data.USDC.available).toBe('9989990000000'); // 99,899.9
    expect(bal1.body.data.USDC.locked).toBe('5005000000'); // 50.05
    expect(bal1.body.data.ETH.available).toBe('10050000000'); // 100.5
    expect(bal1.body.data.ETH.locked).toBe('0');
    // u2 started with 100,000 USDC and 100 ETH
    // u2 sold 0.5 ETH for 50 USDC.
    // u2 should have 100,050 USDC and 99.5 ETH.
    expect(bal2.body.data.USDC.available).toBe('10004995000000'); // 100,049.95
    expect(bal2.body.data.ETH.available).toBe('9950000000'); // 99.5
  });

  it('handles cancellation and unlocks funds', async () => {
    // u1 places a buy order that rests
    const res = await placeOrder(tokenU1, {
      clientOrderId: 'e2e_cancel_1',
      market: 'ETH_USDC',
      side: 'buy',
      type: 'limit',
      price: 90,
      quantity: 1
    });

    expect(res.body.data.orderId).toBeDefined();
    const orderId = res.body.data.orderId;

    const balBefore = await request(app).get('/api/v1/balance').set('Authorization', `Bearer ${tokenU1}`);

    // Cancel the order
    const cancelRes = await request(app)
      .delete(`/api/v1/order/${orderId}?market=ETH_USDC`)
      .set('Authorization', `Bearer ${tokenU1}`);
    
    if (cancelRes.status !== 200) console.error(cancelRes.body);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data[0].type).toBe('ORDER_CANCELLED');

    // Verify balance is unlocked
    const balAfter = await request(app).get('/api/v1/balance').set('Authorization', `Bearer ${tokenU1}`);
    
    // The new order locked 90 USDC. Then cancellation unlocked it.
    expect(BigInt(balAfter.body.data.USDC.locked)).toBe(BigInt(balBefore.body.data.USDC.locked) - 9009000000n);
    expect(BigInt(balAfter.body.data.USDC.available)).toBe(BigInt(balBefore.body.data.USDC.available) + 9009000000n);
  });
});
