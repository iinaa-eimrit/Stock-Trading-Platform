import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { ExchangeProcessor } from '../engine/processor';
import { MatchingEngine } from '../engine/matching-engine';
import { MARKETS } from '../config';
import { parsePriceToTicks, parseQuantityToLots } from '../utils/math';
import { ExchangeCommand } from '../events/commands';
import { OrderAcceptedEvent } from '../events/types';
import { logger } from '../logger';

export function createOrderRouter(processor: ExchangeProcessor, engine: MatchingEngine): Router {
  const router = Router();

  /* ── Place order ── */
  router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { type, side, price, quantity, market, clientOrderId } = req.body;
      const userId = req.userId!;

      logger.info({ clientOrderId, userId, market, side, type, quantity, price }, 'Place order request received');

      if (!clientOrderId || typeof clientOrderId !== 'string') {
        res.status(400).json({ success: false, error: 'clientOrderId required' });
        return;
      }

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

      let priceTicks = 0;
      let quantityLots = 0;
      try {
        quantityLots = parseQuantityToLots(quantity, mkt.lotSize);
        if (type !== 'market') {
          priceTicks = parsePriceToTicks(price, mkt.tickSize);
        }
      } catch (err: any) {
        res.status(400).json({ success: false, error: err.message });
        return;
      }

      const cmd: ExchangeCommand = {
        type: 'PLACE_ORDER',
        clientOrderId,
        userId: req.userId!,
        market,
        side,
        orderType: type,
        priceTicks: price ? price * 1000 : 0,
        quantityLots: quantity * 10000
      };

      const events = await processor.submitCommand(cmd);
      
      const accepted = events.find(e => e.type === 'ORDER_ACCEPTED') as OrderAcceptedEvent;
      const trades = events.filter(e => e.type === 'TRADE_EXECUTED').map((e: any) => ({
        ...e,
        sequenceNumber: e.sequenceNumber.toString()
      }));
      
      res.json({
        success: true,
        data: {
          orderId: accepted?.orderId || clientOrderId,
          status: 'processed',
          trades: trades
        },
      });
    } catch (err: any) {
      if (err.message === 'INSUFFICIENT_BALANCE' || err.message === 'Account not found') {
        res.status(400).json({ success: false, error: err.message });
      } else {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  });

  /* ── Cancel order ── */
  router.delete('/:orderId', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const orderId = req.params.orderId;
      // In a real implementation, we would need to know the market to cancel properly.
      // For this API, let's assume we can derive the market or pass it in body.
      // For now, we will require market in query params: ?market=ETH_USDC
      const market = req.query.market as string;
      if (!market) {
        res.status(400).json({ success: false, error: 'market query param required for cancellation' });
        return;
      }

      const cmd: ExchangeCommand = {
        type: 'CANCEL_ORDER',
        userId: req.userId!,
        orderId,
        market
      };

      const events = await processor.submitCommand(cmd);
      
      const serializedEvents = events.map((e: any) => ({
        ...e,
        sequenceNumber: e.sequenceNumber.toString()
      }));

      res.json({ 
        success: true, 
        data: serializedEvents 
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /* ── Get order ── */
  router.get('/:orderId', authMiddleware, (req: AuthRequest, res: Response) => {
    const order = engine.getOrders().get(req.params.orderId);
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }
    if (order.userId !== req.userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }
    res.json({ 
      success: true, 
      data: { ...order, sequenceNumber: order.sequenceNumber.toString() } 
    });
  });

  /* ── Quote ── */
  router.post('/quote', authMiddleware, (req: AuthRequest, res: Response) => {
    const { market, side, quantity } = req.body;
    if (!market || !side || !quantity) {
      res.status(400).json({ success: false, error: 'market, side, and quantity required' });
      return;
    }

    const mkt = MARKETS.find((m) => m.symbol === market);
    if (!mkt) {
      res.status(400).json({ success: false, error: 'Invalid market' });
      return;
    }

    let quantityLots = 0;
    try {
      quantityLots = parseQuantityToLots(quantity, mkt.lotSize);
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }

    const quote = engine.getQuote(market, side as 'buy' | 'sell', quantityLots);
    if (!quote) {
      res.status(400).json({ success: false, error: 'Insufficient liquidity for quote' });
      return;
    }
    res.json({ success: true, data: quote });
  });

  /* ── User's orders ── */
  router.get('/', authMiddleware, (req: AuthRequest, res: Response) => {
    const orders = Array.from(engine.getOrders().values()).filter(o => o.userId === req.userId!);
    const serializedOrders = orders.map(o => ({ ...o, sequenceNumber: o.sequenceNumber.toString() }));
    res.json({ success: true, data: serializedOrders });
  });

  return router;
}
