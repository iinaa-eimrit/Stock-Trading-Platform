import {
  Order,
  Trade,
  AggregatedBook,
  AggregatedBookLevel,
  QuoteResult,
  OrderSide,
} from './types';

/**
 * Core Orderbook with price-time priority matching.
 *
 * Bids sorted descending by price, ascending by createdAt (FIFO at same price).
 * Asks sorted ascending by price, ascending by createdAt (FIFO at same price).
 *
 * Matching complexity:
 *   - Insertion: O(log n) binary search + O(n) splice (could be O(log n) with a skip list)
 *   - Top-of-book access: O(1)
 *   - Matching: O(k) where k = number of fills per order
 *   - Cancel: O(n) linear scan (could be O(log n) with an order index)
 *
 * For a production exchange, a Red-Black Tree or skip list would replace the sorted
 * array for O(log n) insertion and deletion. This implementation prioritises clarity.
 */
export class Orderbook {
  private bids: Order[] = [];
  private asks: Order[] = [];
  private tradeCounter: number = 0;
  private _lastTradePrice: number | null = null;
  public readonly market: string;

  constructor(market: string) {
    this.market = market;
  }

  get lastTradePrice(): number | null {
    return this._lastTradePrice;
  }

  /* ───────── Limit Order ───────── */

  addLimitOrder(order: Order, takerSide: OrderSide): Trade[] {
    const trades: Trade[] = [];

    if (order.side === 'buy') {
      while (
        order.filledQuantity < order.quantity &&
        this.asks.length > 0 &&
        this.asks[0].price <= order.price
      ) {
        const bestAsk = this.asks[0];
        const fillQty = Math.min(
          order.quantity - order.filledQuantity,
          bestAsk.quantity - bestAsk.filledQuantity
        );

        trades.push(
          this.createTrade(order, bestAsk, bestAsk.price, fillQty, takerSide)
        );

        order.filledQuantity += fillQty;
        bestAsk.filledQuantity += fillQty;

        if (bestAsk.filledQuantity >= bestAsk.quantity) {
          bestAsk.status = 'filled';
          this.asks.shift();
        } else {
          bestAsk.status = 'partially_filled';
        }
      }

      this.finalizeOrder(order, 'buy');
    } else {
      while (
        order.filledQuantity < order.quantity &&
        this.bids.length > 0 &&
        this.bids[0].price >= order.price
      ) {
        const bestBid = this.bids[0];
        const fillQty = Math.min(
          order.quantity - order.filledQuantity,
          bestBid.quantity - bestBid.filledQuantity
        );

        trades.push(
          this.createTrade(bestBid, order, bestBid.price, fillQty, takerSide)
        );

        order.filledQuantity += fillQty;
        bestBid.filledQuantity += fillQty;

        if (bestBid.filledQuantity >= bestBid.quantity) {
          bestBid.status = 'filled';
          this.bids.shift();
        } else {
          bestBid.status = 'partially_filled';
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
      while (order.filledQuantity < order.quantity && this.asks.length > 0) {
        const bestAsk = this.asks[0];
        const fillQty = Math.min(
          order.quantity - order.filledQuantity,
          bestAsk.quantity - bestAsk.filledQuantity
        );
        trades.push(
          this.createTrade(order, bestAsk, bestAsk.price, fillQty, takerSide)
        );

        order.filledQuantity += fillQty;
        bestAsk.filledQuantity += fillQty;

        if (bestAsk.filledQuantity >= bestAsk.quantity) {
          bestAsk.status = 'filled';
          this.asks.shift();
        } else {
          bestAsk.status = 'partially_filled';
        }
      }
    } else {
      while (order.filledQuantity < order.quantity && this.bids.length > 0) {
        const bestBid = this.bids[0];
        const fillQty = Math.min(
          order.quantity - order.filledQuantity,
          bestBid.quantity - bestBid.filledQuantity
        );
        trades.push(
          this.createTrade(bestBid, order, bestBid.price, fillQty, takerSide)
        );

        order.filledQuantity += fillQty;
        bestBid.filledQuantity += fillQty;

        if (bestBid.filledQuantity >= bestBid.quantity) {
          bestBid.status = 'filled';
          this.bids.shift();
        } else {
          bestBid.status = 'partially_filled';
        }
      }
    }

    order.status =
      order.filledQuantity >= order.quantity
        ? 'filled'
        : order.filledQuantity > 0
          ? 'partially_filled'
          : 'cancelled';

    return trades;
  }

  /* ───────── Cancel ───────── */

  cancelOrder(orderId: string): Order | null {
    for (const [i, o] of this.bids.entries()) {
      if (o.id === orderId) {
        this.bids.splice(i, 1);
        o.status = 'cancelled';
        return o;
      }
    }
    for (const [i, o] of this.asks.entries()) {
      if (o.id === orderId) {
        this.asks.splice(i, 1);
        o.status = 'cancelled';
        return o;
      }
    }
    return null;
  }

  /* ───────── Quote ───────── */

  getQuote(side: OrderSide, quantity: number): QuoteResult | null {
    const fills: { price: number; quantity: number }[] = [];
    let remaining = quantity;
    const orders = side === 'buy' ? this.asks : this.bids;

    for (const order of orders) {
      if (remaining <= 0) break;
      const available = order.quantity - order.filledQuantity;
      const fillQty = Math.min(remaining, available);
      fills.push({ price: order.price, quantity: fillQty });
      remaining -= fillQty;
    }

    if (fills.length === 0) return null;

    const totalQuantity = fills.reduce((s, f) => s + f.quantity, 0);
    const totalCost = fills.reduce((s, f) => s + f.price * f.quantity, 0);

    return { avgPrice: totalCost / totalQuantity, totalCost, totalQuantity, fills };
  }

  /* ───────── Aggregated View ───────── */

  getAggregatedBook(depth = 20): AggregatedBook {
    const aggregate = (orders: Order[]): AggregatedBookLevel[] => {
      const levels = new Map<number, number>();
      for (const o of orders) {
        const rem = o.quantity - o.filledQuantity;
        if (rem > 0) levels.set(o.price, (levels.get(o.price) || 0) + rem);
      }
      return Array.from(levels.entries())
        .map(([price, quantity]) => ({
          price: parseFloat(price.toFixed(6)),
          quantity: parseFloat(quantity.toFixed(6)),
        }))
        .slice(0, depth);
    };

    return {
      bids: aggregate(this.bids),
      asks: aggregate(this.asks),
      lastTradePrice: this._lastTradePrice,
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
    if (order.filledQuantity >= order.quantity) {
      order.status = 'filled';
    } else if (order.type === 'ioc') {
      order.status = order.filledQuantity > 0 ? 'partially_filled' : 'cancelled';
    } else {
      order.status = order.filledQuantity > 0 ? 'partially_filled' : 'open';
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
        c.price > order.price ||
        (c.price === order.price && c.createdAt <= order.createdAt)
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
        c.price < order.price ||
        (c.price === order.price && c.createdAt <= order.createdAt)
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
    price: number,
    quantity: number,
    takerSide: OrderSide
  ): Trade {
    this.tradeCounter++;
    this._lastTradePrice = price;

    return {
      id: this.tradeCounter,
      market: this.market,
      price,
      quantity,
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
      buyerId: buyOrder.userId,
      sellerId: sellOrder.userId,
      timestamp: Date.now(),
      takerSide,
    };
  }
}
