import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '1m', target: 100 },
    { duration: '1m', target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // < 1% errors
    http_req_duration: ['p(95)<500'], // 95% of requests < 500ms
  },
};

const BASE_URL = 'http://localhost:3001/api/v1';

// Pre-generated JWTs for test users with known balances
const USERS = [
  { id: 'u1', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1MSIsImlhdCI6MTc4ODA2ODA5MH0.bW9YknHpvWKXeJ64hX2MeSe7v834ktMQfcejyVmkl4g' },
  { id: 'u2', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1MiIsImlhdCI6MTc4ODA2ODA5MH0.MwGArUJwIMimLKn-7EYMetOIqXkaSPCLly_PJSTd6Ag' }
];

export default function () {
  const user = USERS[Math.floor(Math.random() * USERS.length)];
  const headers = {
    'Authorization': `Bearer ${user.token}`,
    'Content-Type': 'application/json',
  };

  const rand = Math.random();
  const clientOrderId = uuidv4();
  
  if (rand < 0.8) {
    // 80% New Orders
    const payload = JSON.stringify({
      clientOrderId,
      market: 'ETH_USDC',
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      type: 'limit',
      price: 2400 + Math.random() * 200,
      quantity: 0.1,
    });

    const res = http.post(`${BASE_URL}/order`, payload, { headers });
    check(res, { 'order placed': (r) => r.status === 200 });

  } else if (rand < 0.9) {
    // 10% Duplicate / Retry Orders
    const payload = JSON.stringify({
      clientOrderId: 'duplicate-test-id-12345',
      market: 'ETH_USDC',
      side: 'buy',
      type: 'limit',
      price: 2500,
      quantity: 0.1,
    });

    const res = http.post(`${BASE_URL}/order`, payload, { headers });
    check(res, { 'duplicate idempotent': (r) => r.status === 200 });
    
  } else {
    // 10% Cancel Orders (just random cancel, might 404, that's fine)
    const res = http.del(`${BASE_URL}/order/random-cancel-id?market=ETH_USDC`, null, { headers });
    check(res, { 'cancel attempted': (r) => r.status === 200 || r.status === 404 });
  }

  sleep(Math.random() * 0.5); // 0-500ms sleep between requests
}
