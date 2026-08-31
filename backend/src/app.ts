import express from 'express';
import cors from 'cors';
import { MARKETS, MARKET_MAKER_CONFIGS, MARKET_MAKER_USER_ID } from './config';
import { MatchingEngine } from './engine/matching-engine';
import { MarketDataService } from './services/market-data';
import authRouter from './routes/auth';
import { createOrderRouter } from './routes/order';
import { createMarketRouter } from './routes/market';
import { authMiddleware, AuthRequest } from './middleware/auth';
import { FileJournal } from './journal/file-journal';
import { SettlementEngine } from './db/settlement';
import { ExchangeProcessor } from './engine/processor';
import { query, pool } from './db/db';
import { metricsClient, registerPoolMetrics, httpRequestsTotal, httpRequestDuration, journalSequence, settledSequence, settlementBacklog } from './metrics';

registerPoolMetrics(pool);

export function createApp() {
  /* ─── Core services ─── */
  const engine = new MatchingEngine(MARKETS);
  const journalPath = process.env.JOURNAL_PATH || 'exchange.journal';
  const journal = new FileJournal(journalPath);
  const settlement = new SettlementEngine();
  const processor = new ExchangeProcessor(engine, journal, settlement);
  const marketData = new MarketDataService(processor);

  // Pre-fill chart history
  for (const cfg of MARKET_MAKER_CONFIGS) {
    marketData.backfillCandles(cfg.market, cfg.basePrice);
  }

  /* ─── Express ─── */
  const app = express();

  const allowedOrigins = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(u => u.trim()).concat('http://localhost:5173')
    : ['http://localhost:5173'];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, '');
      const allowed = allowedOrigins.map(o => o.replace(/\/$/, ''));
      if (allowed.includes(normalized)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  }));
  app.use(express.json());

  // Security Headers
  const helmet = require('helmet');
  app.use(helmet());

  // Rate Limiting
  const rateLimit = require('express-rate-limit');
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000 // limit each IP to 1000 requests per windowMs
  });
  app.use('/api/', limiter);

  // Metrics middleware
  setInterval(() => {
    if (app.locals.journalSequence !== undefined) journalSequence.set(Number(app.locals.journalSequence));
    if (app.locals.settledSequence !== undefined) settledSequence.set(Number(app.locals.settledSequence));
    if (app.locals.settlementBacklog !== undefined) settlementBacklog.set(app.locals.settlementBacklog);
  }, 5000);

  app.use((req, res, next) => {
    const start = process.hrtime();
    res.on('finish', () => {
      const diff = process.hrtime(start);
      const duration = diff[0] + diff[1] / 1e9;
      const route = req.route ? req.route.path : req.path;
      
      httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
      httpRequestDuration.observe({ method: req.method, route, status_code: res.statusCode }, duration);
    });
    next();
  });

  app.use('/api/v1', authRouter);

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/ready', (req, res) => {
    // 1. Is the engine initialized / recovery completed?
    if (!app.locals.isReady) {
      return res.status(503).json({ status: 'syncing', reason: 'RECOVERY_INCOMPLETE' });
    }

    // 2. Are we behind on settlement?
    if (app.locals.settlementBacklog > 0) {
      return res.status(503).json({ 
        status: 'syncing', 
        reason: 'SETTLEMENT_LAG',
        backlog: app.locals.settlementBacklog 
      });
    }

    // 3. Fully ready
    res.json({ 
      status: 'ready',
      journalSequence: app.locals.journalSequence !== undefined ? String(app.locals.journalSequence) : undefined,
      settledSequence: app.locals.settledSequence !== undefined ? String(app.locals.settledSequence) : undefined,
      settlementBacklog: app.locals.settlementBacklog
    });
  });

  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', metricsClient.register.contentType);
      res.end(await metricsClient.register.metrics());
    } catch (err) {
      res.status(500).end(err);
    }
  });

  const requireReady = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!app.locals.isReady) {
      return res.status(503).json({ success: false, error: 'EXCHANGE_NOT_READY' });
    }
    next();
  };

  app.use('/api/v1/order', requireReady, createOrderRouter(processor, engine));
  app.use('/api/v1/markets', createMarketRouter(engine, marketData));

  app.get('/api/v1/balance', authMiddleware, async (req: AuthRequest, res) => {
    try {
      const dbRes = await query(
        `SELECT asset, available_units, locked_units FROM accounts WHERE user_id = $1`, 
        [req.userId!]
      );
      const balances: Record<string, { available: number, locked: number }> = {};
      for (const row of dbRes.rows) {
        balances[row.asset] = {
          available: Number(row.available_units) / 100000000,
          locked: Number(row.locked_units) / 100000000
        };
      }
      res.json({ success: true, data: balances });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return { app, engine, marketData, processor };
}
