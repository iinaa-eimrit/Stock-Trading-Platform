import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer } from 'http';
import { PORT, MARKETS, MARKET_MAKER_CONFIGS } from './config';
import { MatchingEngine } from './engine/matching-engine';
import { MarketDataService } from './services/market-data';
import { WebSocketService } from './services/websocket';
import { MarketMaker } from './services/market-maker';
import authRouter from './routes/auth';
import { createOrderRouter } from './routes/order';
import { createMarketRouter } from './routes/market';
import { authMiddleware, AuthRequest } from './middleware/auth';
import { store } from './db/store';

/* ─── Core services ─── */
const engine = new MatchingEngine(MARKETS);
const marketData = new MarketDataService(engine);

// Pre-fill chart history
for (const cfg of MARKET_MAKER_CONFIGS) {
  marketData.backfillCandles(cfg.market, cfg.basePrice);
}

/* ─── Express ─── */
const app = express();

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:5173']
  : ['http://localhost:5173'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.use('/api/v1', authRouter);
app.use('/api/v1/order', createOrderRouter(engine));
app.use('/api/v1/markets', createMarketRouter(engine, marketData));

app.get('/api/v1/balance', authMiddleware, (req: AuthRequest, res) => {
  res.json({ success: true, data: store.getAllBalances(req.userId!) });
});

/* ─── Serve frontend in production ─── */
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

/* ─── HTTP + WebSocket server ─── */
const server = createServer(app);
new WebSocketService(server, engine, marketData);

/* ─── Market Maker (provides liquidity) ─── */
const mm = new MarketMaker(engine);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Exchange API  → http://0.0.0.0:${PORT}`);
  console.log(`WebSocket     → ws://0.0.0.0:${PORT}/ws`);

  // Start market maker after a short delay so initial orderbook events don't flood
  setTimeout(() => {
    mm.start();
    console.log('Market maker running');
  }, 500);
});
