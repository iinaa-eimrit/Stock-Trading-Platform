import { EventEmitter } from 'events';
import { Candle, Trade } from '../engine/types';
import { MARKETS } from '../config';
import { ExchangeProcessor } from '../engine/processor';
import { ExchangeEvent, TradeExecutedEvent } from '../events/types';

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};

export class MarketDataService extends EventEmitter {
  private candles = new Map<string, Map<string, Candle[]>>();
  private intervals = Object.keys(INTERVAL_MS);

  constructor(processor: ExchangeProcessor) {
    super();
    for (const m of MARKETS) {
      const map = new Map<string, Candle[]>();
      for (const i of this.intervals) map.set(i, []);
      this.candles.set(m.symbol, map);
    }

    processor.on('events', (events: ExchangeEvent[]) => {
      for (const e of events) {
        if (e.type === 'TRADE_EXECUTED') {
          const te = e as TradeExecutedEvent;
          this.processTrade(te.market, {
            id: Number(te.tradeId),
            buyerId: te.makerIsBuyer ? te.makerUserId : te.takerUserId,
            sellerId: te.makerIsBuyer ? te.takerUserId : te.makerUserId,
            buyOrderId: te.makerIsBuyer ? te.makerOrderId : te.takerOrderId,
            sellOrderId: te.makerIsBuyer ? te.takerOrderId : te.makerOrderId,
            priceTicks: te.priceTicks,
            quantityLots: te.quantityLots,
            timestamp: te.timestamp,
            market: te.market,
            takerSide: te.makerIsBuyer ? 'sell' : 'buy'
          });
        }
      }
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
        last.highTicks = Math.max(last.highTicks, trade.priceTicks);
        last.lowTicks = Math.min(last.lowTicks, trade.priceTicks);
        last.closeTicks = trade.priceTicks;
        last.volumeLots += trade.quantityLots;
        this.emit('candle', { market, interval, candle: last });
      } else {
        const c: Candle = {
          market,
          timestamp: time,
          openTicks: trade.priceTicks,
          highTicks: trade.priceTicks,
          lowTicks: trade.priceTicks,
          closeTicks: trade.priceTicks,
          volumeLots: trade.quantityLots,
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
        openTicks: Math.round((price + (Math.random() - 0.5) * wiggle) * 1000),
        highTicks: Math.round((price + Math.random() * wiggle) * 1000),
        lowTicks: Math.round((price - Math.random() * wiggle) * 1000),
        closeTicks: Math.round(price * 1000),
        volumeLots: Math.round((Math.random() * 10 + 0.5) * 10000),
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
          g.highTicks = Math.max(g.highTicks, c.highTicks);
          g.lowTicks = Math.min(g.lowTicks, c.lowTicks);
          g.closeTicks = c.closeTicks;
          g.volumeLots += c.volumeLots;
        } else {
          grouped.set(t, { ...c, timestamp: t });
        }
      }
      dest.push(...Array.from(grouped.values()).sort((a, b) => a.timestamp - b.timestamp));
    }
  }
}
