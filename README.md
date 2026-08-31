# Deterministic Real-Time Exchange Engine

<p align="center">
  <!-- TODO: Replace this placeholder with a 10-second auto-playing GIF of the platform in action -->
  <img src="https://via.placeholder.com/800x400.png?text=Add+10-second+Live+Demo+GIF+Here+(WebSockets+streaming)" alt="Stock Trading Platform Demo" width="800" />
</p>

<p align="center">
  A production-grade financial exchange with real-time orderbook, matching engine, candlestick charts, and full trading UI — built with TypeScript end-to-end. Featuring a price-time-priority matching engine, fixed-point financial arithmetic, SkipList orderbook, durable event journaling, snapshot/replay recovery, PostgreSQL double-entry settlement, idempotent processing, reconciliation, and production-style observability.
</p>
<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white" alt="WebSocket" />
</p>

## Highlights
- **1,250× Faster Cancellation**: Under a controlled 50K-resting-order cancellation benchmark, the SkipList implementation reduced total cancellation time from 37.5s to 29.8ms.
- **Provably Green Test Suite**: 61 automated tests verifying the entire matching pipeline, deterministic operations, idempotency, and harsh crash recovery boundaries.
- **Fail-Safe Integrity**: Survives abrupt process SIGKILLs and PostgreSQL outages without violating financial invariants.

## Why it's interesting

Building a stock exchange demands balancing blistering throughput with zero-tolerance for dropped data. Most side-projects default to CRUD endpoints writing to a database; this project avoids premature database reads by keeping the authoritative matching engine in memory and persisting deterministic event journals. By moving truth to the journal, the engine can be purely deterministic, scalable, and crash-resilient.

## System Architecture

### Why WebSockets over Long-Polling?
For a financial exchange, millisecond latency is critical. We utilize multiplexed WebSockets instead of REST polling because:
1. **Reduced Overhead:** Eliminates HTTP header bloat and connection establishment latency per request.
2. **Real-time Push:** The matching engine instantly broadcasts orderbook changes (`orderbook@market`), trades, and candlestick ticks to subscribed clients without them needing to ask.
3. **State Syncing:** Allows the React frontend to maintain an accurate, lightweight local copy of the orderbook that updates incrementally rather than fetching the full state on every tick.

### State Management & The Matching Engine
- **In-Memory Orderbook:** The core matching engine runs entirely in-memory using highly optimized data structures (price-time priority, binary search insertion for `O(log n)` performance) to ensure microsecond order execution.
- **Trade-offs:** While an in-memory state provides extreme speed, it requires a robust event-sourcing or write-ahead-log (WAL) architecture for fault tolerance. Currently, state persistence is handled periodically to balance durability with latency.

```text
                    Client
                      │
               REST / WebSocket
                      │
                ┌─────▼─────┐
                │ API Layer │
                └─────┬─────┘
                      │
                ┌─────▼─────┐
                │ Risk      │
                └─────┬─────┘
                      │
                ┌─────▼────────┐
                │ Matching     │
                │ SkipList OB  │
                └─────┬────────┘
                      │
                  Domain Events
                      │
             ┌────────┴────────┐
             ▼                 ▼
          Journal          Settlement
             │                 │
        Snapshot/Replay    PostgreSQL
                               │
                         Double Entry
```

## Key Case Studies

### 01 — Fixed-Point Arithmetic

**Problem**: Repeated fractional fills caused IEEE-754 drift.

**Evidence**: A property test produced:
```text
1.9100000000000001 > 1.91
```
and violated a domain invariant.

**Solution**: Moved the core domain to `PriceTicks` and `QuantityLots` with strict integer arithmetic.

**Impact**: The matching and accounting layers no longer depend on floating-point equality.

### 02 — Orderbook Scaling

**Problem**: The naive array-based orderbook had linear cancellation behavior.

**Evidence**: 
```text
1K   → 34.32 ms
10K  → 768.95 ms
50K  → 37.508 s
```

**Solution**: 
```text
SkipList price index
+
FIFO linked price levels
+
OrderId → OrderNode Map
```

**Validation**: 100K deterministic operations were run through both implementations and compared after every operation.

### 03 — PostgreSQL Outage

**Problem**: Journal persistence can succeed while PostgreSQL is temporarily unavailable.

**Solution**:
```text
journal-first
+
idempotent settlement
+
startup catch-up
```

**Failure scenario**:
```text
match
→ journal fsync
→ PostgreSQL failure
→ restart
→ syncSettlement()
→ financial state catches up
```

**Validation**: Reconciliation demonstrated:
```text
materialized accounts
==
ledger-derived balances
==
journal-derived financial state
```

## Engineering Decisions

### Why SkipList?
Because the measured cancellation behavior of the original array implementation became unacceptable at deep books. 

### Why synchronous matching?
Because deterministic sequencing and simple state ownership were more valuable than premature distributed ingestion.

### Why PostgreSQL?
Because financial settlement requires durable transactional state and accounting invariants. 

### Why file journaling?
Because it provides a simple, inspectable durable event history without prematurely introducing a distributed broker.

### Why no Kafka/Redis?
Because benchmarks did not establish a need for distributed ingestion yet. 

## Deliberate Non-Goals

Kafka/Redis ingestion and Kubernetes were intentionally deferred. 

The system first established:
- deterministic matching
- durable journaling
- transactional settlement
- crash recovery
- reconciliation
- measured bottlenecks

Additional distributed infrastructure should be introduced only when a measured workload justifies it.

## Testing & Verification

Run the full application correctness suite:
```bash
cd backend
npm run verify
```

Run the exhaustive test suite including Hostile Database/Process Crash Recovery:
```bash
cd backend
npm run verify:full
```

## Local Setup

```bash
git clone https://github.com/your-username/Stock-Trading-Platform.git
cd Stock-Trading-Platform

# Start the PostgreSQL Database and Prometheus Metrics stack
docker compose up --build -d

# Start the Exchange Backend
cd backend
npm install
npm run migrate
npm run dev
```

*Note: The frontend implementation is provided in the `frontend` folder. It can be run independently with `npm start` after configuring environment variables to point to the backend API.*

## API

The engine supports limit orders, market orders, immediate-or-cancel (IOC) orders, matching, and basic account management over HTTP REST endpoints and streaming WebSocket channels. The API conforms to standard idempotency principles, ensuring duplicate `clientOrderId`s are caught and settled correctly without double-charging users.
