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
| **Deployment** | Railway (backend) · Vercel (frontend) |

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

## Deployment

### Backend → Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub Repo** → select `Stock-Trading-Platform`
2. **Settings:**
   - Root Directory: `backend`
   - Build Command: `npm install && npm run build`
   - Start Command: `node dist/index.js`
3. **Environment Variables:**
   | Variable | Value |
   |----------|-------|
   | `JWT_SECRET` | *(generate a random 64-char string)* |
   | `FRONTEND_URL` | `https://your-app.vercel.app` *(add after Vercel deploy)* |
   | `PORT` | *(Railway sets automatically)* |
4. **Generate Domain** → Settings → Networking → Public Networking
5. Copy the generated URL (e.g. `https://xxx.up.railway.app`)

### Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import `Stock-Trading-Platform` from GitHub
2. **Framework Preset**: Vite
3. **Root Directory**: `frontend`
4. **Environment Variables:**
   | Variable | Value |
   |----------|-------|
   | `VITE_API_URL` | `https://xxx.up.railway.app` *(your Railway backend URL)* |
5. Click **Deploy**

> `VITE_API_URL` is injected at build time — the frontend uses it for REST API calls and WebSocket connections to the backend.

### After Both Are Live

- Go back to Railway → set `FRONTEND_URL` env var to your Vercel URL (e.g. `https://your-app.vercel.app`)
- This enables CORS so the frontend can talk to the backend

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
├── vercel.json               # Vercel deployment config
└── README.md
```

---

## License

MIT

---

<p align="center">
  Built with TypeScript · Inspired by real exchanges like Binance & NSE
</p>
