import {
  Order,
  Trade,
  AggregatedBook,
  AggregatedBookLevel,
  QuoteResult,
  OrderSide,
  IOrderbook,
} from './types';
import { updateOrderStatus } from './state-machine';

/**
 * Core Orderbook with price-time priority matching.
 *
 * Bids sorted descending by price, ascending by createdAt (FIFO at same price).
 * Asks sorted ascending by price, ascending by createdAt (FIFO at same price).
 *
 * Matching complexity:
 *   - Insertion: O(log n) binary search + O(n) splice (could be O(log n) with a skip list)
 *   - Top-of-book access: O(1)
 *   - Matching: O(N) array shift (V8 splice)
 *   - Cancel: O(n) linear scan
 */
export class Orderbook implements IOrderbook {
  private bids: Order[] = [];
  private asks: Order[] = [];
  private tradeCounter: number = 0;
  private _lastTradePriceTicks: number | null = null;
  public readonly market: string;

  constructor(market: string) {
    this.market = market;
  }

  get lastTradePriceTicks(): number | null {
    return this._lastTradePriceTicks;
  }

  /* ───────── Limit Order ───────── */

  addLimitOrder(order: Order, takerSide: OrderSide): Trade[] {
    const trades: Trade[] = [];

    if (order.side === 'buy') {
      while (
        order.filledLots < order.quantityLots &&
        this.asks.length > 0 &&
        this.asks[0].priceTicks <= order.priceTicks
      ) {
        const bestAsk = this.asks[0];
        
        // STP: CANCEL_NEWEST
        if (bestAsk.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestAsk.quantityLots - bestAsk.filledLots
        );

        trades.push(
          this.createTrade(order, bestAsk, bestAsk.priceTicks, fillQty, takerSide)
        );

        order.filledLots += fillQty;
        bestAsk.filledLots += fillQty;

        if (bestAsk.filledLots >= bestAsk.quantityLots) {
          updateOrderStatus(bestAsk, 'filled');
          this.asks.shift();
        } else {
          updateOrderStatus(bestAsk, 'partially_filled');
        }
      }

      this.finalizeOrder(order, 'buy');
    } else {
      while (
        order.filledLots < order.quantityLots &&
        this.bids.length > 0 &&
        this.bids[0].priceTicks >= order.priceTicks
      ) {
        const bestBid = this.bids[0];

        // STP: CANCEL_NEWEST
        if (bestBid.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestBid.quantityLots - bestBid.filledLots
        );

        trades.push(
          this.createTrade(bestBid, order, bestBid.priceTicks, fillQty, takerSide)
        );

        order.filledLots += fillQty;
        bestBid.filledLots += fillQty;

        if (bestBid.filledLots >= bestBid.quantityLots) {
          updateOrderStatus(bestBid, 'filled');
          this.bids.shift();
        } else {
          updateOrderStatus(bestBid, 'partially_filled');
        }
      }

      this.finalizeOrder(order, 'sell');
    }

    return trades;
  }

  /* ───────── Market Order ───────── */

  addMarketOrder(order: Order, takerSide: OrderSide): Trade[] {
    const trades: Trade[] = [];

    if (order.side === 'buy') {
      while (order.filledLots < order.quantityLots && this.asks.length > 0) {
        const bestAsk = this.asks[0];

        // STP: CANCEL_NEWEST
        if (bestAsk.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestAsk.quantityLots - bestAsk.filledLots
        );
        trades.push(
          this.createTrade(order, bestAsk, bestAsk.priceTicks, fillQty, takerSide)
        );

        order.filledLots += fillQty;
        bestAsk.filledLots += fillQty;

        if (bestAsk.filledLots >= bestAsk.quantityLots) {
          updateOrderStatus(bestAsk, 'filled');
          this.asks.shift();
        } else {
          updateOrderStatus(bestAsk, 'partially_filled');
        }
      }
    } else {
      while (order.filledLots < order.quantityLots && this.bids.length > 0) {
        const bestBid = this.bids[0];

        // STP: CANCEL_NEWEST
        if (bestBid.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestBid.quantityLots - bestBid.filledLots
        );
        trades.push(
          this.createTrade(bestBid, order, bestBid.priceTicks, fillQty, takerSide)
        );

        order.filledLots += fillQty;
        bestBid.filledLots += fillQty;

        if (bestBid.filledLots >= bestBid.quantityLots) {
          updateOrderStatus(bestBid, 'filled');
          this.bids.shift();
        } else {
          updateOrderStatus(bestBid, 'partially_filled');
        }
      }
    }

    const finalStatus = order.filledLots >= order.quantityLots
      ? 'filled'
      : order.filledLots > 0
        ? 'partially_filled'
        : 'cancelled';
    updateOrderStatus(order, finalStatus);

    return trades;
  }

  /* ───────── Cancel ───────── */

  cancelOrder(orderId: string): Order | null {
    for (const [i, o] of this.bids.entries()) {
      if (o.id === orderId) {
        this.bids.splice(i, 1);
        updateOrderStatus(o, 'cancelled');
        return o;
      }
    }
    for (const [i, o] of this.asks.entries()) {
      if (o.id === orderId) {
        this.asks.splice(i, 1);
        updateOrderStatus(o, 'cancelled');
        return o;
      }
    }
    return null;
  }

  /* ───────── Quote ───────── */

  getQuote(side: OrderSide, quantityLots: number): QuoteResult | null {
    const fills: { priceTicks: number; quantityLots: number }[] = [];
    let remaining = quantityLots;
    const orders = side === 'buy' ? this.asks : this.bids;

    for (const order of orders) {
      if (remaining <= 0) break;
      const available = order.quantityLots - order.filledLots;
      const fillQty = Math.min(remaining, available);
      fills.push({ priceTicks: order.priceTicks, quantityLots: fillQty });
      remaining -= fillQty;
    }

    if (fills.length === 0) return null;

    const totalLots = fills.reduce((s, f) => s + f.quantityLots, 0);
    const totalCostTicks = fills.reduce((s, f) => s + f.priceTicks * f.quantityLots, 0);

    return { avgPriceTicks: totalCostTicks / totalLots, totalCostTicks, totalLots, fills };
  }

  /* ───────── Aggregated View ───────── */

  getAggregatedBook(depth = 20): AggregatedBook {
    const aggregate = (orders: Order[]): AggregatedBookLevel[] => {
      const levels = new Map<number, number>();
      for (const o of orders) {
        const rem = o.quantityLots - o.filledLots;
        if (rem > 0) levels.set(o.priceTicks, (levels.get(o.priceTicks) || 0) + rem);
      }
      return Array.from(levels.entries())
        .map(([price, quantity]) => ({
          priceTicks: parseFloat(price.toFixed(6)),
          quantityLots: parseFloat(quantity.toFixed(6)),
        }))
        .slice(0, depth);
    };

    return {
      bids: aggregate(this.bids),
      asks: aggregate(this.asks),
      lastTradePriceTicks: this._lastTradePriceTicks,
    };
  }

  getOrder(orderId: string): Order | undefined {
    return (
      this.bids.find((o) => o.id === orderId) ||
      this.asks.find((o) => o.id === orderId)
    );
  }

  /* ───────── Internals ───────── */

  private finalizeOrder(order: Order, side: OrderSide): void {
    if (order.filledLots >= order.quantityLots) {
      updateOrderStatus(order, 'filled');
    } else if (order.type === 'ioc') {
      updateOrderStatus(order, order.filledLots > 0 ? 'partially_filled' : 'cancelled');
    } else {
      updateOrderStatus(order, order.filledLots > 0 ? 'partially_filled' : 'open');
      if (side === 'buy') this.insertBid(order);
      else this.insertAsk(order);
    }
  }

  /** Binary-search insert into bids (desc price, asc time). */
  private insertBid(order: Order): void {
    let lo = 0;
    let hi = this.bids.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = this.bids[mid];
      if (
        c.priceTicks > order.priceTicks ||
        (c.priceTicks === order.priceTicks && c.sequenceNumber <= order.sequenceNumber)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.bids.splice(lo, 0, order);
  }

  /** Binary-search insert into asks (asc price, asc time). */
  private insertAsk(order: Order): void {
    let lo = 0;
    let hi = this.asks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const c = this.asks[mid];
      if (
        c.priceTicks < order.priceTicks ||
        (c.priceTicks === order.priceTicks && c.sequenceNumber <= order.sequenceNumber)
      ) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.asks.splice(lo, 0, order);
  }

  private createTrade(
    buyOrder: Order,
    sellOrder: Order,
    priceTicks: number,
    quantityLots: number,
    takerSide: OrderSide
  ): Trade {
    this.tradeCounter++;
    this._lastTradePriceTicks = priceTicks;

    return {
      id: this.tradeCounter,
      market: this.market,
      priceTicks,
      quantityLots,
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
      buyerId: buyOrder.userId,
      sellerId: sellOrder.userId,
      timestamp: Date.now(),
      takerSide,
    };
  }

  restoreState(orders: Order[]): void {
    this.bids = [];
    this.asks = [];
    
    for (const order of orders) {
      if (order.status !== 'open' && order.status !== 'partially_filled') continue;
      
      const book = order.side === 'buy' ? this.bids : this.asks;
      book.push({ ...order });
    }

    // Sort appropriately
    this.bids.sort((a, b) => {
      if (a.priceTicks !== b.priceTicks) return b.priceTicks - a.priceTicks;
      return a.sequenceNumber < b.sequenceNumber ? -1 : 1;
    });

    this.asks.sort((a, b) => {
      if (a.priceTicks !== b.priceTicks) return a.priceTicks - b.priceTicks;
      return a.sequenceNumber < b.sequenceNumber ? -1 : 1;
    });
  }
}
