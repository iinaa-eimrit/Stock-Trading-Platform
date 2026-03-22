# Exchange — Simplified Financial Exchange System

A production-grade simplified exchange supporting real-time orderbook, matching engine, chart, and trading UI, built with TypeScript end-to-end.

## Quick Start

### 1. Backend

```bash
cd backend
npm install
npm run dev          # starts on http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev          # starts on http://localhost:5173
```

Open **http://localhost:5173**, create an account, and trade.

---

## Supported Markets

| Symbol     | Base | Quote | Description          |
|------------|------|-------|----------------------|
| ETH_USDC   | ETH  | USDC  | Ethereum / USD Coin  |
| BTC_USDC   | BTC  | USDC  | Bitcoin / USD Coin   |
| TATA_INR   | TATA | INR   | Tata / Indian Rupee  |
| SOL_USDC   | SOL  | USDC  | Solana / USD Coin    |

## API Endpoints

### Auth
- `POST /api/v1/signup` — `{ email, password }` → `{ token, userId }`
- `POST /api/v1/signin` — `{ email, password }` → `{ token, userId }`

### Orders (requires `Authorization: Bearer <token>`)
- `POST /api/v1/order` — `{ type, side, price?, quantity, market }`
- `GET /api/v1/order` — list user's orders
- `GET /api/v1/order/:id` — get a specific order
- `DELETE /api/v1/order/:id` — cancel an open order
- `POST /api/v1/order/quote` — `{ market, side, quantity }` → price estimate

### Market Data (public)
- `GET /api/v1/markets` — list all markets
- `GET /api/v1/markets/:market/orderbook`
- `GET /api/v1/markets/:market/trades`
- `GET /api/v1/markets/:market/candles?interval=1m`

### Account
- `GET /api/v1/balance` — user asset balances

## WebSocket

Connect to `ws://localhost:3001/ws`

```json
// Subscribe
{ "method": "subscribe", "params": ["orderbook@ETH_USDC", "trades@ETH_USDC", "ticker@ETH_USDC", "candles@ETH_USDC@1m"] }

// Unsubscribe
{ "method": "unsubscribe", "params": ["ticker@ETH_USDC"] }
```

Streams: `orderbook@{market}` · `trades@{market}` · `ticker@{market}` · `candles@{market}@{interval}`

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed system design, matching engine explanation, scaling strategy, and low-latency optimizations.

## Tech Stack

| Layer     | Technology                  |
|-----------|-----------------------------|
| Backend   | Node.js · Express · TypeScript |
| Matching  | In-memory orderbook engine  |
| WebSocket | ws library                  |
| Frontend  | React · Vite · TypeScript   |
| Charts    | TradingView Lightweight Charts |
