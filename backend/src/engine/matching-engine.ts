import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Orderbook } from './orderbook';
import {
  Order,
  Trade,
  MatchResult,
  QuoteResult,
  OrderSide,
  OrderType,
  AggregatedBook,
} from './types';
import { MarketConfig } from '../config';

/**
 * Central matching engine that manages orderbooks for all markets.
 *
 * Emits:
 *   - 'trades'    { market, trades: Trade[] }
 *   - 'orderbook' { market, book: AggregatedBook }
 *   - 'ticker'    { market, price, timestamp }
 *
 * All matching is synchronous within a single event-loop tick,
 * preventing race conditions on the Node.js single-threaded runtime.
 */
export class MatchingEngine extends EventEmitter {
  private orderbooks = new Map<string, Orderbook>();
  private orders = new Map<string, Order>();
  private trades: Trade[] = [];
  private markets: MarketConfig[];

  constructor(markets: MarketConfig[]) {
    super();
    this.markets = markets;
    for (const m of markets) {
      this.orderbooks.set(m.symbol, new Orderbook(m.symbol));
    }
  }

  placeOrder(params: {
    userId: string;
    market: string;
    side: OrderSide;
    type: OrderType;
    price: number;
    quantity: number;
  }): MatchResult {
    const ob = this.orderbooks.get(params.market);
    if (!ob) throw new Error(`Market ${params.market} not found`);

    const order: Order = {
      id: uuidv4(),
      userId: params.userId,
      market: params.market,
      side: params.side,
      type: params.type,
      price: params.price,
      quantity: params.quantity,
      filledQuantity: 0,
      status: 'open',
      createdAt: Date.now(),
    };

    const trades =
      params.type === 'market'
        ? ob.addMarketOrder(order, params.side)
        : ob.addLimitOrder(order, params.side);

    this.orders.set(order.id, order);
    for (const t of trades) this.trades.push(t);

    if (trades.length > 0) {
      this.emit('trades', { market: params.market, trades });
      const last = trades[trades.length - 1];
      this.emit('ticker', {
        market: params.market,
        price: last.price,
        timestamp: last.timestamp,
      });
    }

    this.emit('orderbook', {
      market: params.market,
      book: ob.getAggregatedBook(),
    });

    return { trades, order };
  }

  cancelOrder(orderId: string): Order | null {
    const order = this.orders.get(orderId);
    if (!order) return null;

    const ob = this.orderbooks.get(order.market);
    if (!ob) return null;

    const cancelled = ob.cancelOrder(orderId);
    if (cancelled) {
      this.orders.set(orderId, cancelled);
      this.emit('orderbook', {
        market: order.market,
        book: ob.getAggregatedBook(),
      });
    }
    return cancelled;
  }

  getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  getQuote(market: string, side: OrderSide, quantity: number): QuoteResult | null {
    return this.orderbooks.get(market)?.getQuote(side, quantity) ?? null;
  }

  getOrderbook(market: string): AggregatedBook | null {
    return this.orderbooks.get(market)?.getAggregatedBook() ?? null;
  }

  getRecentTrades(market: string, limit = 50): Trade[] {
    return this.trades.filter((t) => t.market === market).slice(-limit);
  }

  getMarkets(): MarketConfig[] {
    return this.markets;
  }

  getOrdersByUser(userId: string): Order[] {
    return Array.from(this.orders.values()).filter(
      (o) => o.userId === userId
    );
  }
}
