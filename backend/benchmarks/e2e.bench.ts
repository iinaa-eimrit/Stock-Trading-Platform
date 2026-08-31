import autocannon from 'autocannon';
import { createServer } from 'http';
import { createApp } from '../src/app';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/config';
import * as os from 'os';

import { query } from '../src/db/db';

async function runE2E() {
  const { app } = createApp();
  const server = createServer(app);
  
  // Fund u1 heavily so they don't hit INSUFFICIENT_BALANCE during the load test
  await query(`INSERT INTO accounts (user_id, asset, available_units, locked_units) VALUES ('u1', 'USDC', 1000000000000000, 0) ON CONFLICT (user_id, asset) DO UPDATE SET available_units = 1000000000000000`);
  await query(`INSERT INTO accounts (user_id, asset, available_units, locked_units) VALUES ('u1', 'ETH', 1000000000000000, 0) ON CONFLICT (user_id, asset) DO UPDATE SET available_units = 1000000000000000`);

  server.listen(0, () => {
    const port = (server.address() as any).port;
    const token = jwt.sign({ userId: 'u1' }, JWT_SECRET);

    console.log(`Starting E2E Autocannon benchmark against in-memory API on port ${port}...`);
    
    // We want to generate dynamic request bodies to avoid Duplicate clientOrderId.
    // Autocannon setupRequest allows mutating the request before sending.
    let count = 0;

    const instance = autocannon({
      url: `http://localhost:${port}/api/v1/order`,
      connections: 50, // 50 concurrent users
      pipelining: 1,
      duration: 10, // run for 10 seconds
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      requests: [
        {
          method: 'POST',
          path: '/api/v1/order',
          setupRequest: (req, context) => {
            req.body = JSON.stringify({
              clientOrderId: `e2e_${Date.now()}_${count++}`,
              market: 'ETH_USDC',
              side: Math.random() > 0.5 ? 'buy' : 'sell',
              type: 'limit',
              price: 2000 + Math.floor(Math.random() * 100),
              quantity: 0.1
            });
            return req;
          }
        }
      ]
    }, (err, result) => {
      server.close();
      if (err) {
        console.error(err);
        return;
      }

      console.log(`\nE2E API Benchmark (OS: ${os.platform()}, CPU: ${os.cpus()[0].model})`);
      console.log(`────────────────────────────────────────`);
      console.log(`Connections:       ${result.connections}`);
      console.log(`Duration:          ${result.duration}s`);
      console.log(`Total Requests:    ${result.requests.total}`);
      console.log(`Throughput:        ${(result.requests.average || 0).toFixed(0)} req/sec`);
      console.log(`Latency p50:       ${result.latency.p50} ms`);
      console.log(`Latency p95:       ${(result.latency as any).p95} ms`);
      console.log(`Latency p99:       ${result.latency.p99} ms`);
      console.log(`Errors (TCP/HTTP): ${result.errors}`);
      console.log(`Non-2xx Responses: ${result.non2xx}`); // Important to verify we aren't measuring 400s
      console.log(`────────────────────────────────────────\n`);
    });

    autocannon.track(instance, { renderProgressBar: true });
  });
}

runE2E();
