# Exchange — Architecture & System Design

## 1. System Architecture (Initial Version)

```
┌────────────┐       HTTP + WS        ┌─────────────────────────────────────────────────┐
│   Browser   │ ◄────────────────────► │              API Server (Express)               │
│  React +    │                        │                                                 │
│  WS Client  │                        │  ┌──────────────┐  ┌──────────────────────────┐ │
└────────────┘                        │  │   REST API   │  │   WebSocket Service      │ │
                                       │  │  /api/v1/*   │  │   /ws                    │ │
                                       │  └──────┬───────┘  └──────────┬───────────────┘ │
                                       │         │                     │  ▲               │
                                       │         ▼                     │  │ events        │
                                       │  ┌──────────────────────────┐ │  │               │
                                       │  │   Matching Engine        │─┘  │               │
                                       │  │   (in-memory orderbooks) │────┘               │
                                       │  └──────────┬───────────────┘                    │
                                       │             │ trade events                       │
                                       │             ▼                                    │
                                       │  ┌──────────────────────────┐                    │
                                       │  │  Market Data Service     │                    │
                                       │  │  (OHLC candle builder)   │                    │
                                       │  └──────────────────────────┘                    │
                                       │                                                 │
                                       │  ┌──────────────────────────┐                    │
                                       │  │  Market Maker Bot        │                    │
                                       │  │  (liquidity simulation)  │                    │
                                       │  └──────────────────────────┘                    │
                                       │                                                 │
                                       │  ┌──────────────────────────┐                    │
                                       │  │  Store (in-memory)       │                    │
                                       │  │  Users · Balances        │                    │
                                       │  └──────────────────────────┘                    │
                                       └─────────────────────────────────────────────────┘
```

## 2. Matching Engine — Deep Explanation

### 2.1 Data Structure

Each market has one `Orderbook` containing two sorted arrays:

| Array | Sort Order |
|-------|-----------|
| **Bids** (buy orders) | Descending by price, then ascending by `createdAt` |
| **Asks** (sell orders) | Ascending by price, then ascending by `createdAt` |

This guarantees **price-time priority**: the best-priced order is always at index 0, and among equal prices the earliest order matches first.

### 2.2 Insertion — O(log n)

New orders are inserted using **binary search** to find the correct position, then `Array.splice` for in-place insertion. In a production system, a Red-Black Tree or skip list would avoid the O(n) splice cost, giving O(log n) for both search and insert.

### 2.3 Matching — Limit Orders

For a **buy limit order** at price P:

```
while asks[0].price <= P and remaining qty > 0:
    fill against asks[0] at asks[0].price   ← maker price wins
    if asks[0] is fully filled → remove from asks
update order status (filled / partially_filled / open)
if not fully filled and not IOC → insert into bids
```

For a **sell limit order** at price P:

```
while bids[0].price >= P and remaining qty > 0:
    fill against bids[0] at bids[0].price
    if bids[0] is fully filled → remove from bids
update order status
if not fully filled and not IOC → insert into asks
```

### 2.4 Matching — Market Orders

Identical to limit order matching but **without a price constraint**: the taker sweeps the opposite side until quantity is satisfied or the book is empty.

### 2.5 IOC (Immediate Or Cancel)

Same matching as limit, but if any quantity remains after matching, it is NOT placed on the book — the residual is simply cancelled.

### 2.6 Trade Generation

Each fill creates a `Trade` record with:
- Unique sequential `tradeId`
- Market, price, quantity
- Buyer and seller IDs and order IDs
- `takerSide` — which side initiated the trade (important for chart coloring)

### 2.7 Complexity Summary

| Operation | Current | With Skip List/RBTree |
|-----------|---------|----------------------|
| Insert | O(log n) search + O(n) splice | O(log n) |
| Top-of-book | O(1) | O(1) |
| Match k fills | O(k) | O(k) |
| Cancel | O(n) scan | O(log n) with index |

### 2.8 Concurrency Model

Node.js runs on a single event-loop thread. All matching logic is **synchronous** — balance check, fund locking, matching, trade settlement, and event emission run within a single tick. This eliminates race conditions without explicit locks.

## 3. Database Schema

### Users
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| email | string | Unique, indexed |
| passwordHash | string | bcrypt hashed |
| balances | Map<asset, {available, locked}> | Per-asset balance tracking |

### Orders
| Column | Type |
|--------|------|
| id | UUID |
| userId | UUID → Users.id |
| market | string |
| side | 'buy' \| 'sell' |
| type | 'limit' \| 'market' \| 'ioc' |
| price | number |
| quantity | number |
| filledQuantity | number |
| status | 'open' \| 'partially_filled' \| 'filled' \| 'cancelled' |
| createdAt | timestamp |

### Trades
| Column | Type |
|--------|------|
| id | sequential int |
| market | string |
| price | number |
| quantity | number |
| buyOrderId | UUID |
| sellOrderId | UUID |
| buyerId | UUID |
| sellerId | UUID |
| takerSide | 'buy' \| 'sell' |
| timestamp | number |

### Candles (OHLC)
| Column | Type |
|--------|------|
| market | string |
| timestamp | number (interval start) |
| open | number |
| high | number |
| low | number |
| close | number |
| volume | number |

## 4. Backend Code Structure

```
backend/src/
├── config/index.ts          ← Markets, constants, JWT config
├── db/store.ts              ← In-memory user/balance store
├── engine/
│   ├── types.ts             ← Core domain types
│   ├── orderbook.ts         ← Orderbook with matching logic
│   └── matching-engine.ts   ← Multi-market engine + events
├── middleware/auth.ts        ← JWT authentication
├── routes/
│   ├── auth.ts              ← Signup / Signin
│   ├── order.ts             ← Place / Get / Cancel / Quote
│   └── market.ts            ← Orderbook / Trades / Candles
├── services/
│   ├── market-data.ts       ← OHLC candle aggregation
│   ├── market-maker.ts      ← Liquidity bot
│   └── websocket.ts         ← WS subscription + broadcast
└── index.ts                 ← Server entry point
```

## 5. Frontend Design

```
┌──────────────────────────────────────────────────────────┐
│ Header: Market selector · Ticker price · Logout          │
├──────────┬──────────────────────────┬────────────────────┤
│          │                          │    Orderbook       │
│  Order   │       OHLC Chart         │    Asks (red)      │
│  Form    │  (TradingView Lightweight│    ──── spread ──  │
│          │   Charts)                │    Bids (green)    │
│  Buy/Sell│                          ├────────────────────┤
│  Limit/  │                          │  Recent Trades     │
│  Market  │                          │  (timestamped)     │
├──────────┴──────────────────────────┴────────────────────┤
│ Portfolio: Asset balances                                │
└──────────────────────────────────────────────────────────┘
```

## 6. Scaling Strategy

### Phase 1 → Phase 2 Evolution

| Component | Phase 1 (Current) | Phase 2 (Scaled) |
|-----------|-------------------|-------------------|
| Matching Engine | Single-process in-memory | Dedicated process per market, LMAX Disruptor pattern |
| State | In-memory Maps | PostgreSQL + Redis |
| Pub/Sub | Node EventEmitter | Redis Pub/Sub or Kafka |
| API Gateway | Single Express | API Gateway → multiple services |
| WebSocket | Co-located | Dedicated cluster behind load balancer |
| Queue | N/A | Kafka / NATS for order ingestion |

### Horizontal Scaling Plan

1. **Separate matching engine** into its own process. API servers connect via gRPC or message queue.
2. **Shard by market**: each matching engine instance handles a subset of markets.
3. **WebSocket fan-out**: dedicated WS servers subscribe to Redis Pub/Sub and push to clients. Load balance WS connections across N servers.
4. **Read replicas**: serve orderbook snapshots and trade history from cached read stores.
5. **Event sourcing**: persist every order and trade event to an append-only log (Kafka). Rebuild state by replaying events.

### Future Architecture

```
Client → API Gateway → Order Queue (Kafka)
                              ↓
                    Matching Engine (per market)
                              ↓
                    Trade Events → Kafka
                     ↓            ↓           ↓
              Market Data    WebSocket     Database
              Service        Broadcaster   Writer
```

## 7. Low-Latency Optimizations

### Current Implementation
- **Single-threaded synchronous matching** — no context switching, no lock contention
- **In-memory data structures** — no I/O during matching
- **Binary search insertion** — O(log n) order placement
- **Top-of-book access** — O(1) best bid/ask
- **No database writes on hot path** — matching and event emission are CPU-only

### Production Optimizations
1. **Kernel bypass (DPDK/io_uring)** — avoid syscall overhead for network I/O.
2. **Memory-mapped ring buffers (LMAX Disruptor)** — lock-free inter-thread communication between network ingress, matching, and event publication.
3. **CPU pinning + NUMA awareness** — pin the matching thread to a dedicated core, co-locate memory on the same NUMA node.
4. **Pre-allocated object pools** — avoid GC pauses by reusing Order/Trade objects.
5. **Binary protocol (FIX/SBE)** — replace JSON with Simple Binary Encoding for 10x lower serialization overhead.
6. **Colocation** — matching engine physically close to participants' servers.
7. **Busy-spin instead of epoll** — for sub-microsecond latency, busy-wait on the network socket.
8. **Write-ahead log** — persist to NVMe for durability without blocking the matching loop.

### Latency Targets
| Tier | Latency | Approach |
|------|---------|----------|
| Retail exchange | < 10 ms | Current Node.js approach |
| Professional | < 1 ms | Dedicated C++/Rust matching engine |
| HFT/Colocation | < 10 μs | FPGA + kernel bypass |

## 8. Real-World Exchange Engineering Insights

### Market Maker Design
The built-in market maker provides liquidity by:
- Placing limit orders on both sides of the mid-price
- Maintaining configurable spread (0.2%) and depth (15 levels)
- Periodically refreshing orders (every 3s)
- Occasionally crossing the spread to generate trades

This simulates real market dynamics — without a market maker, the orderbook would be empty.

### Self-Trade Prevention
Production exchanges must prevent a user's buy order from matching their own sell order. Approaches:
- **Cancel oldest** — cancel the resting order, place the new one
- **Cancel newest** — reject the incoming order
- **Cancel both** — cancel both orders

### Circuit Breakers
Halt trading when price moves > X% in Y minutes to prevent flash crashes. Implementation: track rolling price window, reject orders outside bounds.

### Deterministic Replay
Every order event is logged sequentially. The entire exchange state can be rebuilt by replaying events from the log — essential for disaster recovery and auditing.

### Fair Queuing
In co-location environments, ensure network fairness — all participants' messages arrive at the matching engine at the same logical time within a batch window.

### Risk Checks (Pre-Trade)
- Position limits per user
- Order rate limits
- Price band validation (reject orders far from market)
- Margin requirements for leveraged products

### Settlement
This demo settles instantly (atomic balance transfers). Real exchanges use T+1 or T+2 settlement with a clearing house intermediary.
