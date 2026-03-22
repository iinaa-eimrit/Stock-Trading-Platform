import { EventEmitter } from 'events';
import { MatchingEngine } from '../engine/matching-engine';
import { Candle, Trade } from '../engine/types';

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

export class MarketDataService extends EventEmitter {
  private candles = new Map<string, Map<string, Candle[]>>();
  private intervals = Object.keys(INTERVAL_MS);

  constructor(engine: MatchingEngine) {
    super();
    for (const m of engine.getMarkets()) {
      const map = new Map<string, Candle[]>();
      for (const i of this.intervals) map.set(i, []);
      this.candles.set(m.symbol, map);
    }

    engine.on('trades', ({ market, trades }: { market: string; trades: Trade[] }) => {
      for (const t of trades) this.processTrade(market, t);
    });
  }

  private processTrade(market: string, trade: Trade): void {
    for (const interval of this.intervals) {
      const ms = INTERVAL_MS[interval];
      const time = Math.floor(trade.timestamp / ms) * ms;
      const arr = this.candles.get(market)?.get(interval);
      if (!arr) continue;

      const last = arr[arr.length - 1];
      if (last && last.timestamp === time) {
        last.high = Math.max(last.high, trade.price);
        last.low = Math.min(last.low, trade.price);
        last.close = trade.price;
        last.volume += trade.quantity;
        this.emit('candle', { market, interval, candle: last });
      } else {
        const c: Candle = {
          market,
          timestamp: time,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          volume: trade.quantity,
        };
        arr.push(c);
        this.emit('candle', { market, interval, candle: c });
      }
    }
  }

  getCandles(market: string, interval: string, limit = 500): Candle[] {
    return this.candles.get(market)?.get(interval)?.slice(-limit) ?? [];
  }

  /** Generate synthetic historical 1m candles so the chart isn't empty on startup. */
  backfillCandles(market: string, basePrice: number, count = 200): void {
    const ms = INTERVAL_MS['1m'];
    const now = Date.now();
    const arr = this.candles.get(market)?.get('1m');
    if (!arr) return;

    let price = basePrice;
    for (let i = count; i > 0; i--) {
      const time = Math.floor((now - i * ms) / ms) * ms;
      const drift = (Math.random() - 0.49) * basePrice * 0.004;
      price = Math.max(basePrice * 0.85, Math.min(basePrice * 1.15, price + drift));
      const wiggle = basePrice * 0.002;

      arr.push({
        market,
        timestamp: time,
        open: parseFloat((price + (Math.random() - 0.5) * wiggle).toFixed(2)),
        high: parseFloat((price + Math.random() * wiggle).toFixed(2)),
        low: parseFloat((price - Math.random() * wiggle).toFixed(2)),
        close: parseFloat(price.toFixed(2)),
        volume: parseFloat((Math.random() * 10 + 0.5).toFixed(4)),
      });
    }

    this.buildHigherTimeframes(market);
  }

  private buildHigherTimeframes(market: string): void {
    const src = this.candles.get(market)?.get('1m') ?? [];
    for (const interval of ['5m', '15m', '1h']) {
      const ms = INTERVAL_MS[interval];
      const dest = this.candles.get(market)?.get(interval);
      if (!dest) continue;

      const grouped = new Map<number, Candle>();
      for (const c of src) {
        const t = Math.floor(c.timestamp / ms) * ms;
        const g = grouped.get(t);
        if (g) {
          g.high = Math.max(g.high, c.high);
          g.low = Math.min(g.low, c.low);
          g.close = c.close;
          g.volume += c.volume;
        } else {
          grouped.set(t, { ...c, timestamp: t });
        }
      }
      dest.push(...Array.from(grouped.values()).sort((a, b) => a.timestamp - b.timestamp));
    }
  }
}
