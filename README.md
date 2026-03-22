<h1 align="center">Stock Trading Platform</h1>

<p align="center">
  A production-grade financial exchange with real-time orderbook, matching engine, candlestick charts, and full trading UI — built with TypeScript end-to-end.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socketdotio&logoColor=white" alt="WebSocket" />
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/iinaa-eimrit/Stock-Trading-Platform?style=flat-square" alt="License" />
  <img src="https://img.shields.io/github/last-commit/iinaa-eimrit/Stock-Trading-Platform?style=flat-square" alt="Last Commit" />
  <img src="https://img.shields.io/github/repo-size/iinaa-eimrit/Stock-Trading-Platform?style=flat-square" alt="Repo Size" />
  <img src="https://img.shields.io/github/languages/top/iinaa-eimrit/Stock-Trading-Platform?style=flat-square" alt="Top Language" />
</p>

---

## Features

- **Matching Engine** — In-memory orderbook with price-time priority, binary search insertion O(log n), supports limit/market/IOC orders with partial fills
- **Real-time Streaming** — WebSocket-powered live orderbook, trades, tickers, and candlestick updates
- **Candlestick Charts** — OHLC charts via TradingView Lightweight Charts with 1m/5m/15m/1h intervals
- **4 Trading Markets** — ETH/USDC, BTC/USDC, TATA/INR, SOL/USDC
- **Market Maker Bot** — Automated liquidity provider with 15 levels of depth per side
- **Portfolio Management** — Real-time balance tracking with fund locking
- **JWT Authentication** — Secure signup/signin with bcrypt password hashing
- **Fully Typed** — End-to-end TypeScript with zero type errors

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js · Express · TypeScript |
| **Matching Engine** | Custom in-memory orderbook with price-time priority |
| **Real-time** | WebSocket (ws library) |
| **Frontend** | React 18 · Vite 5 · TypeScript |
| **Charts** | TradingView Lightweight Charts |
| **Auth** | JWT · bcryptjs |
| **Deployment** | Railway |

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### 1. Clone

```bash
git clone https://github.com/iinaa-eimrit/Stock-Trading-Platform.git
cd Stock-Trading-Platform
```

### 2. Backend

```bash
cd backend
npm install
npm run dev          # starts on http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # starts on http://localhost:5173
```

Open **http://localhost:5173**, create an account, and start trading.

---

## Supported Markets

| Symbol | Base | Quote | Description |
|--------|------|-------|-------------|
| ETH_USDC | ETH | USDC | Ethereum / USD Coin |
| BTC_USDC | BTC | USDC | Bitcoin / USD Coin |
| TATA_INR | TATA | INR | Tata / Indian Rupee |
| SOL_USDC | SOL | USDC | Solana / USD Coin |

---

## API Reference

### Auth
| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| POST | `/api/v1/signup` | `{ email, password }` | `{ token, userId }` |
| POST | `/api/v1/signin` | `{ email, password }` | `{ token, userId }` |

### Orders (requires `Authorization: Bearer <token>`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/order` | Place order `{ type, side, price?, quantity, market }` |
| GET | `/api/v1/order` | List user's orders |
| GET | `/api/v1/order/:id` | Get specific order |
| DELETE | `/api/v1/order/:id` | Cancel open order |
| POST | `/api/v1/order/quote` | Get price estimate `{ market, side, quantity }` |

### Market Data (public)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/markets` | List all markets |
| GET | `/api/v1/markets/:market/orderbook` | Orderbook snapshot |
| GET | `/api/v1/markets/:market/trades` | Recent trades |
| GET | `/api/v1/markets/:market/candles?interval=1m` | OHLC candles |

### Account
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/balance` | User asset balances |

---

## WebSocket

Connect to `ws://localhost:3001/ws` (or `wss://` in production)

```json
{ "method": "subscribe", "params": ["orderbook@ETH_USDC", "trades@ETH_USDC", "ticker@ETH_USDC", "candles@ETH_USDC@1m"] }
```

| Stream | Format | Description |
|--------|--------|-------------|
| `orderbook@{market}` | `{ bids, asks }` | Live orderbook depth |
| `trades@{market}` | `Trade[]` | Real-time trade feed |
| `ticker@{market}` | `{ price, timestamp }` | Last price tick |
| `candles@{market}@{interval}` | `Candle` | Live OHLC updates |

---

## Deployment on Railway

This project is configured for **Railway** deployment as a monorepo.

### Option A: Single Service (Recommended)

Deploy the backend which also serves the frontend in production:

1. **New Project** → **Deploy from GitHub Repo** → select `Stock-Trading-Platform`
2. **Settings:**
   - Root Directory: `/` (default)
   - Build Command: `cd frontend && npm install && npm run build && cd ../backend && npm install && npm run build`
   - Start Command: `cd backend && NODE_ENV=production node dist/index.js`
3. **Environment Variables:**
   | Variable | Value |
   |----------|-------|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | *(generate a random 64-char string)* |
   | `PORT` | *(Railway sets automatically)* |
4. **Generate Domain** → Settings → Networking → Public Networking

### Option B: Split Services (Frontend + Backend)

**Backend service:**
- Root Directory: `backend`
- Build Command: `npm install && npm run build`
- Start Command: `node dist/index.js`
- Environment: `NODE_ENV=production`, `JWT_SECRET=<random>`

**Frontend service:**
- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Environment: `VITE_API_URL=https://<your-backend-domain>.up.railway.app`

> Frontend reads `VITE_API_URL` at build time to connect API & WebSocket to the backend.

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design including:

- System architecture diagram
- Matching engine deep-dive (price-time priority, binary search, fill logic)
- Database schema
- Scaling strategy (horizontal scaling, event bus, CQRS)
- Low-latency optimizations

---

## Project Structure

```
Stock-Trading-Platform/
├── backend/
│   ├── src/
│   │   ├── config/          # Markets, env vars, market maker configs
│   │   ├── db/              # In-memory user & balance store
│   │   ├── engine/          # Orderbook + matching engine core
│   │   ├── middleware/      # JWT auth middleware
│   │   ├── routes/          # REST API routes
│   │   ├── services/        # WebSocket, market data, market maker
│   │   └── index.ts         # Server entry point
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api/             # REST API client
│   │   ├── components/      # React UI components
│   │   ├── hooks/           # WebSocket hook
│   │   ├── types/           # TypeScript interfaces
│   │   ├── App.tsx          # Main application
│   │   └── main.tsx         # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── docs/
│   └── ARCHITECTURE.md      # System design documentation
├── railway.json              # Railway deployment config
└── README.md
```

---

## License

MIT

---

<p align="center">
  Built with TypeScript · Inspired by real exchanges like Binance & NSE
</p>
