import { ExchangeProcessor } from '../engine/processor';
import { MARKET_MAKER_USER_ID, MARKET_MAKER_CONFIGS } from '../config';
import { v4 as uuidv4 } from 'uuid';

interface MMConfig {
  market: string;
  basePrice: number;
  spread: number;
  levels: number;
  levelStep: number;
  baseQuantity: number;
  refreshInterval: number;
}

export class MarketMaker {
  private processor: ExchangeProcessor;
  private configs: MMConfig[];
  private orderIds = new Map<string, string[]>();
  private timers: NodeJS.Timeout[] = [];

  constructor(processor: ExchangeProcessor) {
    this.processor = processor;
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

  private async refresh(cfg: MMConfig): Promise<void> {
    // Cancel stale orders
    const old = this.orderIds.get(cfg.market) ?? [];
    for (const id of old) {
      this.processor.submitCommand({
        type: 'CANCEL_ORDER',
        market: cfg.market,
        orderId: id,
        userId: MARKET_MAKER_USER_ID,
      }).catch(() => {});
    }

    const book = this.processor.engine.getOrderbook(cfg.market);
    const mid = book?.lastTradePriceTicks ?? cfg.basePrice;
    const ids: string[] = [];

    // Place limit bids & asks at multiple levels
    for (let i = 0; i < cfg.levels; i++) {
      const bidFactor = 1 - cfg.spread / 2 - i * cfg.levelStep;
      const askFactor = 1 + cfg.spread / 2 + i * cfg.levelStep;
      const qty = parseFloat((cfg.baseQuantity * (0.8 + Math.random() * 0.4)).toFixed(6));

      try {
        const bidEvents = await this.processor.submitCommand({
          type: 'PLACE_ORDER',
          userId: MARKET_MAKER_USER_ID,
          clientOrderId: uuidv4(),
          market: cfg.market,
          side: 'buy',
          orderType: 'limit',
          priceTicks: parseFloat((mid * bidFactor).toFixed(2)),
          quantityLots: qty,
        });
        const bidAccept = bidEvents.find((e: any) => e.type === 'ORDER_ACCEPTED') as any;
        if (bidAccept && (bidAccept.order.status === 'open' || bidAccept.order.status === 'partially_filled')) {
          ids.push(bidAccept.order.id);
        }
      } catch { /* skip */ }

      try {
        const askEvents = await this.processor.submitCommand({
          type: 'PLACE_ORDER',
          userId: MARKET_MAKER_USER_ID,
          clientOrderId: uuidv4(),
          market: cfg.market,
          side: 'sell',
          orderType: 'limit',
          priceTicks: parseFloat((mid * askFactor).toFixed(2)),
          quantityLots: qty,
        });
        const askAccept = askEvents.find((e: any) => e.type === 'ORDER_ACCEPTED') as any;
        if (askAccept && (askAccept.order.status === 'open' || askAccept.order.status === 'partially_filled')) {
          ids.push(askAccept.order.id);
        }
      } catch { /* skip */ }
    }

    // Occasionally place a small market order to generate a trade
    if (Math.random() < 0.35) {
      const side = Math.random() < 0.5 ? 'buy' : 'sell';
      const qty = parseFloat((cfg.baseQuantity * Math.random() * 0.3).toFixed(6));
      if (qty > 0) {
        try {
          await this.processor.submitCommand({
            type: 'PLACE_ORDER',
            userId: MARKET_MAKER_USER_ID,
            clientOrderId: uuidv4(),
            market: cfg.market,
            side,
            orderType: 'market',
            priceTicks: 0,
            quantityLots: qty,
          });
        } catch { /* skip */ }
      }
    }

    this.orderIds.set(cfg.market, ids);
  }
}
