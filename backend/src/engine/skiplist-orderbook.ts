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

// ----------------------------------------------------------------------------
// Deterministic RNG (Linear Congruential Generator)
// ----------------------------------------------------------------------------
class LCG {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  nextFloat(): number {
    // Constants from glibc
    this.state = (this.state * 1103515245 + 12345) % 0x80000000;
    return this.state / 0x80000000;
  }
}

// ----------------------------------------------------------------------------
// Data Structures
// ----------------------------------------------------------------------------

export class OrderNode {
  public prev: OrderNode | null = null;
  public next: OrderNode | null = null;
  constructor(public order: Order, public level: PriceLevel) {}
}

export class PriceLevel {
  public head: OrderNode | null = null;
  public tail: OrderNode | null = null;
  public volumeLots: number = 0;

  constructor(public priceTicks: number) {}

  append(node: OrderNode): void {
    if (!this.tail) {
      this.head = node;
      this.tail = node;
    } else {
      this.tail.next = node;
      node.prev = this.tail;
      this.tail = node;
    }
    this.volumeLots += (node.order.quantityLots - node.order.filledLots);
  }

  remove(node: OrderNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;

    node.prev = null;
    node.next = null;
    this.volumeLots -= (node.order.quantityLots - node.order.filledLots);
  }

  isEmpty(): boolean {
    return this.head === null;
  }
}

class SkipNode {
  public forward: (SkipNode | null)[];
  constructor(public priceTicks: number, public level: PriceLevel | null, maxLevel: number) {
    this.forward = new Array(maxLevel).fill(null);
  }
}

export type Comparator = (a: number, b: number) => number; // returns <0 if a comes before b

class SkipList {
  private readonly MAX_LEVEL = 16;
  private readonly P = 0.5;
  private head: SkipNode;
  private level: number = 1;

  constructor(private cmp: Comparator, private rng: LCG) {
    // The head acts as a sentinel. Its priceTicks is conceptually -Infinity or +Infinity,
    // but we just never compare it directly against inserted elements.
    this.head = new SkipNode(0, null, this.MAX_LEVEL);
  }

  private randomLevel(): number {
    let lvl = 1;
    while (this.rng.nextFloat() < this.P && lvl < this.MAX_LEVEL) {
      lvl++;
    }
    return lvl;
  }

  insert(priceTicks: number): PriceLevel {
    const update: SkipNode[] = new Array(this.MAX_LEVEL).fill(this.head);
    let x = this.head;

    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] !== null && this.cmp(x.forward[i]!.priceTicks, priceTicks) < 0) {
        x = x.forward[i]!;
      }
      update[i] = x;
    }

    x = x.forward[0]!;

    if (x && x.priceTicks === priceTicks) {
      return x.level!; // Already exists
    } else {
      const lvl = this.randomLevel();
      if (lvl > this.level) {
        for (let i = this.level; i < lvl; i++) {
          update[i] = this.head;
        }
        this.level = lvl;
      }

      const newLevel = new PriceLevel(priceTicks);
      const newNode = new SkipNode(priceTicks, newLevel, lvl);

      for (let i = 0; i < lvl; i++) {
        newNode.forward[i] = update[i].forward[i];
        update[i].forward[i] = newNode;
      }
      return newLevel;
    }
  }

  get(priceTicks: number): PriceLevel | null {
    let x = this.head;
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] !== null && this.cmp(x.forward[i]!.priceTicks, priceTicks) < 0) {
        x = x.forward[i]!;
      }
    }
    x = x.forward[0]!;
    if (x && x.priceTicks === priceTicks) {
      return x.level;
    }
    return null;
  }

  remove(priceTicks: number): void {
    const update: SkipNode[] = new Array(this.MAX_LEVEL).fill(this.head);
    let x = this.head;

    for (let i = this.level - 1; i >= 0; i--) {
      while (x.forward[i] !== null && this.cmp(x.forward[i]!.priceTicks, priceTicks) < 0) {
        x = x.forward[i]!;
      }
      update[i] = x;
    }

    x = x.forward[0]!;

    if (x && x.priceTicks === priceTicks) {
      for (let i = 0; i < this.level; i++) {
        if (update[i].forward[i] !== x) break;
        update[i].forward[i] = x.forward[i];
      }
      while (this.level > 1 && this.head.forward[this.level - 1] === null) {
        this.level--;
      }
    }
  }

  /** Iterate over all levels in sorted order */
  *levels(): IterableIterator<PriceLevel> {
    let x = this.head.forward[0];
    while (x) {
      if (x.level) yield x.level;
      x = x.forward[0];
    }
  }

  getBestLevel(): PriceLevel | null {
    let x = this.head.forward[0];
    return x ? x.level : null;
  }
}

// ----------------------------------------------------------------------------
// Orderbook
// ----------------------------------------------------------------------------

export class SkipListOrderbook implements IOrderbook {
  public readonly market: string;
  private tradeCounter: number = 0;
  private _lastTradePriceTicks: number | null = null;

  private bids: SkipList; // Highest price first
  private asks: SkipList; // Lowest price first
  private orderMap = new Map<string, OrderNode>();

  constructor(market: string, seed: number = 42) {
    this.market = market;
    const rng1 = new LCG(seed);
    const rng2 = new LCG(seed + 1); // offset seed for asks so they don't correlate exactly
    
    // Bids: a comes before b if a > b (descending)
    this.bids = new SkipList((a, b) => b - a, rng1);
    
    // Asks: a comes before b if a < b (ascending)
    this.asks = new SkipList((a, b) => a - b, rng2);
  }

  get lastTradePriceTicks(): number | null {
    return this._lastTradePriceTicks;
  }

  /* ───────── Internals ───────── */

  private insertOrder(order: Order, side: OrderSide): void {
    const skipList = side === 'buy' ? this.bids : this.asks;
    const priceLevel = skipList.insert(order.priceTicks);
    const node = new OrderNode(order, priceLevel);
    priceLevel.append(node);
    this.orderMap.set(order.id, node);
  }

  private removeOrder(orderId: string): Order | null {
    const node = this.orderMap.get(orderId);
    if (!node) return null;

    const level = node.level;
    level.remove(node);
    this.orderMap.delete(orderId);

    if (level.isEmpty()) {
      const skipList = node.order.side === 'buy' ? this.bids : this.asks;
      skipList.remove(level.priceTicks);
    }

    return node.order;
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
      timestamp: Date.now(), // Deterministic property tests do not rely on timestamp directly
      takerSide,
    };
  }

  /* ───────── Match Logic ───────── */

  addLimitOrder(order: Order, takerSide: OrderSide): Trade[] {
    const trades: Trade[] = [];

    if (order.side === 'buy') {
      while (order.filledLots < order.quantityLots) {
        const bestAskLvl = this.asks.getBestLevel();
        if (!bestAskLvl || bestAskLvl.priceTicks > order.priceTicks) break;

        const bestAskNode = bestAskLvl.head;
        if (!bestAskNode) {
          // Should never happen, but clean up if it does
          this.asks.remove(bestAskLvl.priceTicks);
          continue;
        }

        const bestAsk = bestAskNode.order;

        // STP: CANCEL_NEWEST
        if (bestAsk.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestAsk.quantityLots - bestAsk.filledLots
        );

        trades.push(this.createTrade(order, bestAsk, bestAsk.priceTicks, fillQty, takerSide));

        order.filledLots += fillQty;
        bestAsk.filledLots += fillQty;

        if (bestAsk.filledLots >= bestAsk.quantityLots) {
          updateOrderStatus(bestAsk, 'filled');
          this.removeOrder(bestAsk.id);
        } else {
          updateOrderStatus(bestAsk, 'partially_filled');
          // Update the volume for the partial fill
          bestAskLvl.volumeLots -= fillQty;
        }
      }

      this.finalizeOrder(order, 'buy');
    } else {
      while (order.filledLots < order.quantityLots) {
        const bestBidLvl = this.bids.getBestLevel();
        if (!bestBidLvl || bestBidLvl.priceTicks < order.priceTicks) break;

        const bestBidNode = bestBidLvl.head;
        if (!bestBidNode) {
          this.bids.remove(bestBidLvl.priceTicks);
          continue;
        }

        const bestBid = bestBidNode.order;

        // STP: CANCEL_NEWEST
        if (bestBid.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestBid.quantityLots - bestBid.filledLots
        );

        trades.push(this.createTrade(bestBid, order, bestBid.priceTicks, fillQty, takerSide));

        order.filledLots += fillQty;
        bestBid.filledLots += fillQty;

        if (bestBid.filledLots >= bestBid.quantityLots) {
          updateOrderStatus(bestBid, 'filled');
          this.removeOrder(bestBid.id);
        } else {
          updateOrderStatus(bestBid, 'partially_filled');
          bestBidLvl.volumeLots -= fillQty;
        }
      }

      this.finalizeOrder(order, 'sell');
    }

    return trades;
  }

  addMarketOrder(order: Order, takerSide: OrderSide): Trade[] {
    const trades: Trade[] = [];

    if (order.side === 'buy') {
      while (order.filledLots < order.quantityLots) {
        const bestAskLvl = this.asks.getBestLevel();
        if (!bestAskLvl) break;

        const bestAskNode = bestAskLvl.head;
        if (!bestAskNode) {
          this.asks.remove(bestAskLvl.priceTicks);
          continue;
        }

        const bestAsk = bestAskNode.order;

        // STP: CANCEL_NEWEST
        if (bestAsk.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestAsk.quantityLots - bestAsk.filledLots
        );

        trades.push(this.createTrade(order, bestAsk, bestAsk.priceTicks, fillQty, takerSide));

        order.filledLots += fillQty;
        bestAsk.filledLots += fillQty;

        if (bestAsk.filledLots >= bestAsk.quantityLots) {
          updateOrderStatus(bestAsk, 'filled');
          this.removeOrder(bestAsk.id);
        } else {
          updateOrderStatus(bestAsk, 'partially_filled');
          bestAskLvl.volumeLots -= fillQty;
        }
      }
    } else {
      while (order.filledLots < order.quantityLots) {
        const bestBidLvl = this.bids.getBestLevel();
        if (!bestBidLvl) break;

        const bestBidNode = bestBidLvl.head;
        if (!bestBidNode) {
          this.bids.remove(bestBidLvl.priceTicks);
          continue;
        }

        const bestBid = bestBidNode.order;

        // STP: CANCEL_NEWEST
        if (bestBid.userId === order.userId) {
          updateOrderStatus(order, 'cancelled');
          return trades;
        }

        const fillQty = Math.min(
          order.quantityLots - order.filledLots,
          bestBid.quantityLots - bestBid.filledLots
        );

        trades.push(this.createTrade(bestBid, order, bestBid.priceTicks, fillQty, takerSide));

        order.filledLots += fillQty;
        bestBid.filledLots += fillQty;

        if (bestBid.filledLots >= bestBid.quantityLots) {
          updateOrderStatus(bestBid, 'filled');
          this.removeOrder(bestBid.id);
        } else {
          updateOrderStatus(bestBid, 'partially_filled');
          bestBidLvl.volumeLots -= fillQty;
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

  private finalizeOrder(order: Order, side: OrderSide): void {
    if (order.filledLots >= order.quantityLots) {
      updateOrderStatus(order, 'filled');
    } else if (order.type === 'ioc') {
      updateOrderStatus(order, order.filledLots > 0 ? 'partially_filled' : 'cancelled');
    } else {
      updateOrderStatus(order, order.filledLots > 0 ? 'partially_filled' : 'open');
      this.insertOrder(order, side);
    }
  }

  /* ───────── Cancel ───────── */

  cancelOrder(orderId: string): Order | null {
    const node = this.orderMap.get(orderId);
    if (!node) return null;
    const order = node.order;
    updateOrderStatus(order, 'cancelled');
    this.removeOrder(orderId);
    return order;
  }

  /* ───────── Interface Reads ───────── */

  getOrder(orderId: string): Order | undefined {
    return this.orderMap.get(orderId)?.order;
  }

  getQuote(side: OrderSide, quantityLots: number): QuoteResult | null {
    const fills: { priceTicks: number; quantityLots: number }[] = [];
    let remaining = quantityLots;
    
    const skipList = side === 'buy' ? this.asks : this.bids;
    
    for (const level of skipList.levels()) {
      if (remaining <= 0) break;
      
      let curr = level.head;
      while (curr && remaining > 0) {
        const available = curr.order.quantityLots - curr.order.filledLots;
        const fillQty = Math.min(remaining, available);
        fills.push({ priceTicks: level.priceTicks, quantityLots: fillQty });
        remaining -= fillQty;
        curr = curr.next;
      }
    }

    if (fills.length === 0) return null;

    const totalLots = fills.reduce((s, f) => s + f.quantityLots, 0);
    const totalCostTicks = fills.reduce((s, f) => s + f.priceTicks * f.quantityLots, 0);

    return { avgPriceTicks: totalCostTicks / totalLots, totalCostTicks, totalLots, fills };
  }

  getAggregatedBook(depth = 20): AggregatedBook {
    const aggregate = (skipList: SkipList): AggregatedBookLevel[] => {
      const levels: AggregatedBookLevel[] = [];
      for (const level of skipList.levels()) {
        if (levels.length >= depth) break;
        if (level.volumeLots > 0) {
          levels.push({
            priceTicks: level.priceTicks,
            quantityLots: level.volumeLots,
          });
        }
      }
      return levels;
    };

    return {
      bids: aggregate(this.bids),
      asks: aggregate(this.asks),
      lastTradePriceTicks: this._lastTradePriceTicks,
    };
  }

  restoreState(orders: Order[]): void {
    // Clear current state
    const seed = 42; // We reuse 42, but ideally the caller tracks the seed for snapshots
    const rng1 = new LCG(seed);
    const rng2 = new LCG(seed + 1);
    this.bids = new SkipList((a, b) => b - a, rng1);
    this.asks = new SkipList((a, b) => a - b, rng2);
    this.orderMap.clear();

    // The order we insert doesn't strictly matter for SkipList structure if LCG is synced, 
    // but to preserve exact determinism, we should insert them in sequence number order.
    const sorted = [...orders].sort((a, b) => a.sequenceNumber < b.sequenceNumber ? -1 : 1);

    for (const order of sorted) {
      if (order.status !== 'open' && order.status !== 'partially_filled') continue;
      this.insertOrder({ ...order }, order.side);
    }
  }
}
