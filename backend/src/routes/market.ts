import { Router, Request, Response } from 'express';
import { MatchingEngine } from '../engine/matching-engine';
import { MarketDataService } from '../services/market-data';

export function createMarketRouter(engine: MatchingEngine, marketData: MarketDataService): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const markets = engine.getMarkets().map((m: string) => {
      const book = engine.getOrderbook(m);
      return {
        id: m,
        symbol: m,
        lastTradePriceTicks: book?.lastTradePriceTicks ?? null
      };
    });
    res.json({ success: true, data: markets });
  });

  router.get('/:market/orderbook', (req: Request, res: Response) => {
    const book = engine.getOrderbook(req.params.market);
    if (!book) {
      res.status(404).json({ success: false, error: 'Market not found' });
      return;
    }
    res.json({ success: true, data: book });
  });

  router.get('/:market/trades', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    res.json({ success: true, data: engine.getRecentTrades(req.params.market) });
  });

  router.get('/:market/candles', (req: Request, res: Response) => {
    const interval = (req.query.interval as string) || '1m';
    const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);
    res.json({ success: true, data: marketData.getCandles(req.params.market, interval, limit) });
  });

  return router;
}
