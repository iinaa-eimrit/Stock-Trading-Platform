import { MatchingEngine } from '../engine/matching-engine';
import { MARKET_MAKER_USER_ID, MARKET_MAKER_CONFIGS } from '../config';

interface MMConfig {
  market: string;
  basePrice: number;
  spread: number;
  levels: number;
  levelStep: number;
  baseQuantity: number;
  refreshInterval: number;
}

/**
 * Simple market maker that provides liquidity by placing limit orders on both
 * sides of the current price. Periodically cancels and replaces orders, and
 * occasionally crosses the spread with a small market order to generate trades.
 */
export class MarketMaker {
  private engine: MatchingEngine;
  private configs: MMConfig[];
  private orderIds = new Map<string, string[]>();
  private timers: NodeJS.Timeout[] = [];

  constructor(engine: MatchingEngine) {
    this.engine = engine;
    this.configs = MARKET_MAKER_CONFIGS;
  }

  start(): void {
    for (const cfg of this.configs) {
      this.orderIds.set(cfg.market, []);
      this.refresh(cfg);
      this.timers.push(setInterval(() => this.refresh(cfg), cfg.refreshInterval));
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private refresh(cfg: MMConfig): void {
    // Cancel stale orders
    const old = this.orderIds.get(cfg.market) ?? [];
    for (const id of old) this.engine.cancelOrder(id);

    const book = this.engine.getOrderbook(cfg.market);
    const mid = book?.lastTradePrice ?? cfg.basePrice;
    const ids: string[] = [];

    // Place limit bids & asks at multiple levels
    for (let i = 0; i < cfg.levels; i++) {
      const bidFactor = 1 - cfg.spread / 2 - i * cfg.levelStep;
      const askFactor = 1 + cfg.spread / 2 + i * cfg.levelStep;
      const qty = parseFloat((cfg.baseQuantity * (0.8 + Math.random() * 0.4)).toFixed(6));

      try {
        const bid = this.engine.placeOrder({
          userId: MARKET_MAKER_USER_ID,
          market: cfg.market,
          side: 'buy',
          type: 'limit',
          price: parseFloat((mid * bidFactor).toFixed(2)),
          quantity: qty,
        });
        if (bid.order.status === 'open' || bid.order.status === 'partially_filled') {
          ids.push(bid.order.id);
        }
      } catch { /* skip */ }

      try {
        const ask = this.engine.placeOrder({
          userId: MARKET_MAKER_USER_ID,
          market: cfg.market,
          side: 'sell',
          type: 'limit',
          price: parseFloat((mid * askFactor).toFixed(2)),
          quantity: qty,
        });
        if (ask.order.status === 'open' || ask.order.status === 'partially_filled') {
          ids.push(ask.order.id);
        }
      } catch { /* skip */ }
    }

    // Occasionally place a small market order to generate a trade
    if (Math.random() < 0.35) {
      const side = Math.random() < 0.5 ? 'buy' : 'sell';
      const qty = parseFloat((cfg.baseQuantity * Math.random() * 0.3).toFixed(6));
      if (qty > 0) {
        try {
          this.engine.placeOrder({
            userId: MARKET_MAKER_USER_ID,
            market: cfg.market,
            side,
            type: 'market',
            price: 0,
            quantity: qty,
          });
        } catch { /* skip */ }
      }
    }

    this.orderIds.set(cfg.market, ids);
  }
}
