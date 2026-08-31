import client from 'prom-client';
import { Pool } from 'pg';

// Enable default metrics (CPU, memory, Event Loop lag)
client.collectDefaultMetrics();

// 1. HTTP Latency Histogram
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// 2. Order Metrics
export const ordersAcceptedTotal = new client.Counter({
  name: 'orders_accepted_total',
  help: 'Total number of orders accepted',
  labelNames: ['market', 'side', 'type'],
});

export const ordersRejectedTotal = new client.Counter({
  name: 'orders_rejected_total',
  help: 'Total number of orders rejected',
  labelNames: ['market', 'reason'],
});

export const ordersCancelledTotal = new client.Counter({
  name: 'orders_cancelled_total',
  help: 'Total number of orders cancelled',
  labelNames: ['market'],
});

export const activeOrders = new client.Gauge({
  name: 'active_orders',
  help: 'Current number of active limit orders in the orderbook',
  labelNames: ['market'],
});

// 3. System & Settlement Metrics
export const matchingDuration = new client.Histogram({
  name: 'matching_duration_seconds',
  help: 'Duration of matching engine execution',
  labelNames: ['market'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});

export const journalAppendDuration = new client.Histogram({
  name: 'journal_append_duration_seconds',
  help: 'Duration of appending events to the FileJournal',
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
});

export const settlementDuration = new client.Histogram({
  name: 'settlement_duration_seconds',
  help: 'Duration of Postgres settlement transactions',
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

export const settlementSuccessTotal = new client.Counter({
  name: 'settlement_success_total',
  help: 'Total successful settlement batches',
});

export const settlementFailureTotal = new client.Counter({
  name: 'settlement_failure_total',
  help: 'Total failed settlement batches',
});

export const settlementRetryTotal = new client.Counter({
  name: 'settlement_retry_total',
  help: 'Total settlement retries due to errors',
});

export const journalSequence = new client.Gauge({
  name: 'journal_sequence',
  help: 'Current sequence number appended to the journal',
});

export const settledSequence = new client.Gauge({
  name: 'settled_sequence',
  help: 'Current sequence number successfully settled in PostgreSQL',
});

export const settlementBacklog = new client.Gauge({
  name: 'settlement_backlog',
  help: 'Number of events in the journal waiting to be settled to Postgres',
});

// 4. WebSocket
export const websocketConnections = new client.Gauge({
  name: 'websocket_connections',
  help: 'Current number of active WebSocket connections',
});

// 5. DB Pool
export const pgPoolTotal = new client.Gauge({
  name: 'pg_pool_total',
  help: 'Total number of connections in the pg pool',
});
export const pgPoolIdle = new client.Gauge({
  name: 'pg_pool_idle',
  help: 'Total number of idle connections in the pg pool',
});
export const pgPoolWaiting = new client.Gauge({
  name: 'pg_pool_waiting',
  help: 'Total number of queries waiting for a pg pool connection',
});

export function registerPoolMetrics(pool: Pool) {
  setInterval(() => {
    pgPoolTotal.set(pool.totalCount);
    pgPoolIdle.set(pool.idleCount);
    pgPoolWaiting.set(pool.waitingCount);
  }, 5000);
}

export { client as metricsClient };
