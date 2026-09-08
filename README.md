# Deterministic Real-Time Exchange Simulator

<p align="center">
  A deterministic real-time exchange simulator and matching engine built with TypeScript.
</p>
<p align="center">
  <b>Core:</b> TypeScript · Node.js · React · WebSockets · PostgreSQL<br/>
  <b>Engineering:</b> Deterministic matching · Fixed-point arithmetic · SkipList orderbook · Event journal · Snapshot/replay · ACID double-entry settlement · Idempotent processing · Reconciliation · Prometheus · Docker · GitHub Actions · k6
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
- **Measured Cancellation Optimization**: A controlled benchmark reduced cancellation time from 37.5s to 29.8ms at 50K resting orders by replacing linear order scanning with a SkipList price index and an $O(1)$ order-ID lookup map.
- **Differential & Property Testing**: Differential testing across 100K operations verifying that the SkipList and array implementations produce identical trades, fills, and ledger states under randomized operations.
- **Crash Recovery & Reconciliation**: Write-ahead event journaling with snapshot/replay recovery verified to survive simulated `SIGKILL` termination, settling idempotently into PostgreSQL with automated 3-way balance reconciliation.

## Why I built this
I wanted to explore the engineering tradeoffs behind real-time exchange systems: deterministic matching, financial precision, durable event history, transactional settlement, crash recovery, and performance under deep orderbooks.

## System Architecture

### Why WebSockets over Long-Polling?
For a financial exchange, millisecond latency is critical. We utilize multiplexed WebSockets instead of REST polling because:
1. **Reduced Overhead:** Eliminates HTTP header bloat and connection establishment latency per request.
2. **Real-time Push:** The matching engine instantly broadcasts orderbook changes (`orderbook@market`), trades, and candlestick ticks to subscribed clients without them needing to ask.
3. **State Syncing:** Allows the React frontend to maintain an accurate, lightweight local copy of the orderbook that updates incrementally rather than fetching the full state on every tick.

### State Management & The Matching Engine
- **In-Memory Orderbook:** The optimized orderbook uses a SkipList-indexed price structure with FIFO-linked price levels and O(1) order-ID lookup/removal. The original array implementation is retained as a behavioral reference for differential testing and benchmarking.
- **Trade-offs:** While an in-memory state provides low-latency execution, it requires an event-sourcing or write-ahead-log (WAL) architecture for fault tolerance. Currently, state persistence is handled periodically to balance durability with latency.
- **Fee Model:** The exchange charges a symmetrical `0.1%` fee to both Makers and Takers for executed trades. The settlement engine is responsible for computing and deducting this `0.1%` fee from the buyer/seller during trade finalization.

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

### 02 — Orderbook Scaling & Algorithmic Complexity

**Problem**: The naive array-based orderbook suffered from $O(N)$ linear scanning during order cancellation and deep book updates. Under 50,000 resting orders, cancelling an order degraded to tens of seconds due to repeated array splicing and shifting.

**Algorithmic Complexity Nuance**:
- **Direct Order Lookup**: $O(1)$ via in-memory `orderMap: Map<string, OrderNode>`.
- **Node Unlinking from Price Level**: $O(1)$ via doubly-linked list pointers (`prev` / `next`) on `PriceLevel`.
- **Price Level Deletion (Depleted Levels)**: $O(\log M)$ where $M$ is the count of distinct active price levels in the SkipList. In typical trading patterns where price levels retain resting volume, cancellations operate strictly in $O(1)$ time; when the last order at a price is removed, the level is cleanly pruned from the SkipList index in $O(\log M)$ time.

**Benchmark Results**:
Measured under a controlled 100K-operation differential test suite comparing the naive array implementation against the SkipList + OrderID Map:

| Orderbook Depth | Naive Array Cancellation | SkipList + Map Cancellation | Speedup Factor | Complexity Mode |
| :--- | :--- | :--- | :--- | :--- |
| **1,000 resting orders** | 34.32 ms | 0.81 ms | **~42×** | $O(N)$ vs $O(1)$ |
| **10,000 resting orders** | 768.95 ms | 6.24 ms | **~123×** | $O(N)$ vs $O(1)$ |
| **50,000 resting orders** | 37,508.10 ms (37.5s) | 29.82 ms | **~1,258×** | $O(N)$ vs $O(1)$ |

**Raw Benchmark Telemetry (Sample from `backend/benchmarks/reports/`)**:
```json
{
  "node": "v20.x / win32-x64",
  "workload": "cancellation-heavy",
  "seed": 42,
  "orders": 10000,
  "results": {
    "throughput": "30,466 ops/sec",
    "p50": "19.4 µs",
    "p95": "42.6 µs",
    "p99": "139.7 µs",
    "max": "17.2 ms"
  }
}
```

**Differential Validation**: 100,000 randomized operations were executed concurrently through both the naive array and SkipList engines, validating identical orderbook state, fills, and balances at every single step.

### 03 — Failure Recovery & Financial Invariant Verification

**Problem**: In high-throughput exchanges, matching engine state must remain strictly consistent across abrupt process crashes, unhandled exceptions, and downstream PostgreSQL outages without losing trades or double-crediting balances.

**Crash Recovery Sequence**:
```text
1. In-Flight Trade Executed
   │
2. Synchronous Journal Write (WAL append + fsync)
   │
3. [CRASH SIMULATION / SIGKILL] ──► Downstream PostgreSQL Not Yet Updated
   │
4. Process Restart & Recovery
   │
5. syncSettlement() Replays Unprocessed Journal Events
   │
6. Idempotent PostgreSQL Settlement (ON CONFLICT DO NOTHING)
   │
7. Financial Balances Reconciled
```

**Automated Invariant Verification**:
After crash recovery and load runs, an automated reconciliation suite verifies a strict 3-way financial invariant across all accounts:
```text
Materialized Account Balances ≡ Ledger Double-Entry Sums ≡ Journal Event Stream Balances
```
If any divergence is detected down to a single satoshi/cent, the engine refuses startup and halts.

> **Invariant:** Recovery may replay events more than once, but the resulting financial state must remain idempotent and converge to the same ledger-derived balances.

### 04 — Failure Boundaries & Operational Semantics

| Scenario | System Behavior & Guarantee |
| :--- | :--- |
| **Simulated `SIGKILL` Termination** | In-flight memory state is lost, but the write-ahead journal (`file-journal.ts`) is flushed synchronously before client ACK. On restart, the engine loads the last hourly snapshot and deterministically replays events starting at `snapshot.lastEventSequenceNumber + 1`. |
| **PostgreSQL Outage / Settlement Latency** | Matching and journaling continue uninterrupted. The journal retains uncommitted records; when the database reconnects, `syncSettlement()` replays pending trades into PostgreSQL using `ON CONFLICT (id) DO NOTHING` within ACID double-entry balance transactions. |
| **Crash Mid-Snapshot** | Snapshots are written to `.snapshot.tmp` and atomically renamed only upon full serialization. A corrupted or partial snapshot file is ignored in favor of the previous valid snapshot + subsequent journal stream. |
| **Duplicate Client Order (Idempotency)** | Orders submit with unique `clientOrderId`. Duplicate incoming orders are rejected at the risk gate without mutating orderbook state or balance reservations. |

---

## 🛠️ Engineering Postmortem: What Broke While Building This

1. **IEEE-754 Precision Drift Under Fractional Fills**:
   - *Failure*: Matching partial fills using standard JavaScript `number` types resulted in fractional float drift (e.g., `1.9100000000000001 > 1.91`), failing balance invariant assertions.
   - *Fix*: Replaced floating-point math with strict integer domain value objects: `PriceTicks` (cents/ticks) and `QuantityLots` (base units).
2. **Memory Leaks from Depleted Price Levels**:
   - *Failure*: During high-frequency cancel workloads, orders were removed from doubly-linked lists but empty `PriceLevel` nodes lingered in the SkipList, accumulating memory and slowing down $O(\log M)$ traversals.
   - *Fix*: Added an explicit check in `removeOrder`: when `level.isEmpty()`, immediately prune `priceTicks` from the SkipList index.
3. **Double-Crediting on Re-entrant Settlement Batches**:
   - *Failure*: If the settlement worker process died midway through flushing an event batch to PostgreSQL, restarting the worker re-executed balance updates for already-settled trades.
   - *Fix*: Enforced unique database constraints on `trade_id` and wrapped trade insertion and double-entry balance updates inside serializable transactions (`ON CONFLICT DO NOTHING`).

### Reproduce Benchmarks & Verification

The differential scaling benchmark and crash recovery suite can be reproduced locally:

```bash
cd backend
npm install

# 1. Run 100K-operation differential benchmark (Naive Array vs SkipList scaling)
npm run test:differential:stress

# 2. Run crash recovery and double-entry reconciliation test
npm run test:recovery

# 3. Run hostile crash test (simulated SIGKILL mid-journaling)
npm run test:recovery:hostile
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

*Note: The k6 load-testing suite is configured as an informational synthetic benchmark to monitor latency trends under local load, rather than as a claim of production exchange throughput.*

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
git clone https://github.com/iinaa-eimrit/Stock-Trading-Platform.git
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
