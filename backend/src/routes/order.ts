import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { MatchingEngine } from '../engine/matching-engine';
import { store } from '../db/store';
import { MARKETS, MARKET_MAKER_USER_ID } from '../config';

export function createOrderRouter(engine: MatchingEngine): Router {
  const router = Router();

  /* ── Place order ── */
  router.post('/', authMiddleware, (req: AuthRequest, res: Response) => {
    try {
      const { type, side, price, quantity, market } = req.body;
      const userId = req.userId!;

      if (!['limit', 'market', 'ioc'].includes(type)) {
        res.status(400).json({ success: false, error: 'Invalid order type' });
        return;
      }
      if (!['buy', 'sell'].includes(side)) {
        res.status(400).json({ success: false, error: 'Invalid side' });
        return;
      }
      if (!quantity || quantity <= 0) {
        res.status(400).json({ success: false, error: 'Invalid quantity' });
        return;
      }
      if (type !== 'market' && (!price || price <= 0)) {
        res.status(400).json({ success: false, error: 'Price required for limit/ioc orders' });
        return;
      }

      const mkt = MARKETS.find((m) => m.symbol === market);
      if (!mkt) {
        res.status(400).json({ success: false, error: 'Invalid market' });
        return;
      }

      // Lock funds (skip for market maker)
      if (userId !== MARKET_MAKER_USER_ID) {
        if (side === 'buy') {
          const cost =
            type === 'market'
              ? estimateMarketBuyCost(engine, market, quantity)
              : price * quantity;
          if (!store.lockFunds(userId, mkt.quoteAsset, cost)) {
            res.status(400).json({ success: false, error: 'Insufficient balance' });
            return;
          }
        } else {
          if (!store.lockFunds(userId, mkt.baseAsset, quantity)) {
            res.status(400).json({ success: false, error: 'Insufficient balance' });
            return;
          }
        }
      }

      const result = engine.placeOrder({
        userId,
        market,
        side,
        type,
        price: type === 'market' ? 0 : price,
        quantity,
      });

      // Settle trades
      for (const t of result.trades) {
        store.executeTrade(t.buyerId, t.sellerId, mkt.baseAsset, mkt.quoteAsset, t.price, t.quantity);
      }

      // Unlock leftover if order is fully resolved
      if (userId !== MARKET_MAKER_USER_ID) {
        const rem = quantity - result.order.filledQuantity;
        if (
          rem > 0 &&
          (result.order.status === 'filled' || result.order.status === 'cancelled')
        ) {
          if (side === 'buy') {
            store.unlockFunds(userId, mkt.quoteAsset, (type === 'market' ? 0 : price) * rem);
          } else {
            store.unlockFunds(userId, mkt.baseAsset, rem);
          }
        }
      }

      res.json({
        success: true,
        data: {
          orderId: result.order.id,
          status: result.order.status,
          filledQuantity: result.order.filledQuantity,
          trades: result.trades.map((t) => ({
            id: t.id,
            price: t.price,
            quantity: t.quantity,
            timestamp: t.timestamp,
          })),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /* ── Get order ── */
  router.get('/:orderId', authMiddleware, (req: AuthRequest, res: Response) => {
    const order = engine.getOrder(req.params.orderId);
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    if (order.userId !== req.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    res.json({ success: true, data: order });
  });

  /* ── Cancel order ── */
  router.delete('/:orderId', authMiddleware, (req: AuthRequest, res: Response) => {
    const order = engine.getOrder(req.params.orderId);
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    if (order.userId !== req.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const cancelled = engine.cancelOrder(req.params.orderId);
    if (!cancelled) {
      res.status(400).json({ success: false, error: 'Cannot cancel order' });
      return;
    }

    const mkt = MARKETS.find((m) => m.symbol === order.market)!;
    const rem = order.quantity - order.filledQuantity;
    if (order.side === 'buy') {
      store.unlockFunds(req.userId!, mkt.quoteAsset, order.price * rem);
    } else {
      store.unlockFunds(req.userId!, mkt.baseAsset, rem);
    }

    res.json({ success: true, data: cancelled });
  });

  /* ── Quote ── */
  router.post('/quote', authMiddleware, (req: AuthRequest, res: Response) => {
    const { market, side, quantity } = req.body;
    if (!market || !side || !quantity) {
      res.status(400).json({ success: false, error: 'market, side, and quantity required' });
      return;
    }

    const quote = engine.getQuote(market, side, quantity);
    if (!quote) {
      res.status(400).json({ success: false, error: 'Insufficient liquidity for quote' });
      return;
    }
    res.json({ success: true, data: quote });
  });

  /* ── User's orders ── */
  router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
    const orders = engine.getOrdersByUser(req.userId!);
    res.json({ success: true, data: orders });
  });

  return router;
}

function estimateMarketBuyCost(engine: MatchingEngine, market: string, quantity: number): number {
  const q = engine.getQuote(market, 'buy', quantity);
  return q ? q.totalCost * 1.05 : 0;
}
