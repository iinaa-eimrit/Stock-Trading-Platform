import { v4 as uuidv4 } from 'uuid';
import { Orderbook } from './orderbook';
import {
  Order,
  Trade,
  OrderSide,
  OrderType,
  AggregatedBook,
  IOrderbook,
} from './types';
import { MarketConfig } from '../config';
import { ExchangeCommand } from '../events/commands';
import { ExchangeEvent, ExchangeEventBase, OrderAcceptedEvent, TradeExecutedEvent, OrderPartiallyFilledEvent, OrderFilledEvent, OrderCancelledEvent } from '../events/types';

export class MatchingEngine {
  private orderbooks = new Map<string, IOrderbook>();
  private orders = new Map<string, Order>();
  private markets: MarketConfig[];
  
  // Deterministic sequence generation for all events
  private sequenceCounter: bigint = 0n;

  constructor(markets: MarketConfig[], orderbookFactory: (market: string) => IOrderbook = (m) => new Orderbook(m)) {
    this.markets = markets;
    for (const m of markets) {
      this.orderbooks.set(m.symbol, orderbookFactory(m.symbol));
    }
  }

  private nextSequence(): bigint {
    this.sequenceCounter++;
    return this.sequenceCounter;
  }

  public getSequence(): bigint {
    return this.sequenceCounter;
  }
  
  public setSequence(seq: bigint): void {
    this.sequenceCounter = seq;
  }



  getRecentTrades(market: string): any[] {
    return []; // Disabled in Phase 4
  }

  getMarkets(): string[] {
    return Array.from(this.orderbooks.keys());
  }

  public processCommand(cmd: ExchangeCommand): ExchangeEvent[] {
    const events: ExchangeEvent[] = [];

    if (cmd.type === 'PLACE_ORDER') {
      const ob = this.orderbooks.get(cmd.market);
      if (!ob) throw new Error(`Market ${cmd.market} not found`);

      const order: Order = {
        id: uuidv4(),
        clientOrderId: cmd.clientOrderId,
        userId: cmd.userId,
        market: cmd.market,
        side: cmd.side,
        type: cmd.orderType,
        priceTicks: cmd.priceTicks,
        quantityLots: cmd.quantityLots,
        filledLots: 0,
        status: 'open',
        sequenceNumber: this.sequenceCounter + 1n, // order sequence matches the ACCEPTED event sequence
        createdAt: Date.now(),
      };

      const acceptedEvent: OrderAcceptedEvent = {
        type: 'ORDER_ACCEPTED',
        eventId: uuidv4(),
        sequenceNumber: this.nextSequence(),
        timestamp: Date.now(),
        market: cmd.market,
        orderId: order.id,
        clientOrderId: cmd.clientOrderId,
        userId: cmd.userId,
        side: cmd.side,
        orderType: cmd.orderType,
        priceTicks: cmd.priceTicks,
        quantityLots: cmd.quantityLots
      };
      events.push(acceptedEvent);

      this.orders.set(order.id, order);

      // Execute in engine
      const trades = cmd.orderType === 'market'
        ? ob.addMarketOrder(order, cmd.side)
        : ob.addLimitOrder(order, cmd.side);

      // Process trades into events
      let remainingLots = cmd.quantityLots;

      for (const t of trades) {
        // Trade Executed Event
        events.push({
          type: 'TRADE_EXECUTED',
          eventId: uuidv4(),
          sequenceNumber: this.nextSequence(),
          timestamp: Date.now(),
          market: cmd.market,
          tradeId: t.id.toString(),
          makerOrderId: cmd.side === 'buy' ? t.sellOrderId : t.buyOrderId,
          makerUserId: cmd.side === 'buy' ? t.sellerId : t.buyerId,
          takerOrderId: order.id,
          takerUserId: cmd.userId,
          priceTicks: t.priceTicks,
          quantityLots: t.quantityLots,
          makerIsBuyer: cmd.side === 'sell'
        });

        // Update taker logic
        remainingLots -= t.quantityLots;
        
        // Emitting maker filled state
        const makerOrder = this.orders.get(cmd.side === 'buy' ? t.sellOrderId : t.buyOrderId);
        if (makerOrder) {
          if (makerOrder.status === 'filled') {
            events.push({
              type: 'ORDER_FILLED',
              eventId: uuidv4(),
              sequenceNumber: this.nextSequence(),
              timestamp: Date.now(),
              market: cmd.market,
              orderId: makerOrder.id,
              userId: makerOrder.userId,
              filledLots: makerOrder.quantityLots
            });
          } else {
            events.push({
              type: 'ORDER_PARTIALLY_FILLED',
              eventId: uuidv4(),
              sequenceNumber: this.nextSequence(),
              timestamp: Date.now(),
              market: cmd.market,
              orderId: makerOrder.id,
              userId: makerOrder.userId,
              filledLots: makerOrder.filledLots,
              remainingLots: makerOrder.quantityLots - makerOrder.filledLots
            });
          }
        }
      }

      // Taker status events
      if (order.status === 'cancelled') {
        // This handles STP cancellations or Immediate-Or-Cancel with no fills
        events.push({
          type: 'ORDER_CANCELLED',
          eventId: uuidv4(),
          sequenceNumber: this.nextSequence(),
          timestamp: Date.now(),
          market: cmd.market,
          orderId: order.id,
          userId: cmd.userId,
          side: order.side,
          priceTicks: order.priceTicks,
          remainingLots: remainingLots,
          reason: cmd.orderType === 'ioc' ? 'ioc_no_fill' : (cmd.orderType === 'market' ? 'market_no_liquidity' : 'SELF_TRADE_PREVENTION')
        });
      } else if (order.status === 'filled') {
        events.push({
          type: 'ORDER_FILLED',
          eventId: uuidv4(),
          sequenceNumber: this.nextSequence(),
          timestamp: Date.now(),
          market: cmd.market,
          orderId: order.id,
          userId: cmd.userId,
          filledLots: cmd.quantityLots
        });
      } else if (order.status === 'partially_filled') {
        events.push({
          type: 'ORDER_PARTIALLY_FILLED',
          eventId: uuidv4(),
          sequenceNumber: this.nextSequence(),
          timestamp: Date.now(),
          market: cmd.market,
          orderId: order.id,
          userId: cmd.userId,
          filledLots: order.filledLots,
          remainingLots: remainingLots
        });
        
        // If it was IOC/Market and still partially filled, it is cancelled
        if (cmd.orderType === 'ioc' || cmd.orderType === 'market') {
          const cancelled = ob.cancelOrder(order.id);
          events.push({
            type: 'ORDER_CANCELLED',
            eventId: uuidv4(),
            sequenceNumber: this.nextSequence(),
            timestamp: Date.now(),
            market: cmd.market,
            orderId: order.id,
            userId: cmd.userId,
            side: order.side,
            priceTicks: order.priceTicks,
            remainingLots: remainingLots,
            reason: cmd.orderType === 'ioc' ? 'ioc_no_fill' : 'market_no_liquidity'
          });
        }
      } else {
        // Open
        if (cmd.orderType === 'ioc' || cmd.orderType === 'market') {
          const cancelled = ob.cancelOrder(order.id);
          events.push({
            type: 'ORDER_CANCELLED',
            eventId: uuidv4(),
            sequenceNumber: this.nextSequence(),
            timestamp: Date.now(),
            market: cmd.market,
            orderId: order.id,
            userId: cmd.userId,
            side: order.side,
            priceTicks: order.priceTicks,
            remainingLots: remainingLots,
            reason: cmd.orderType === 'ioc' ? 'ioc_no_fill' : 'market_no_liquidity'
          });
        }
      }
    } 
    else if (cmd.type === 'CANCEL_ORDER') {
      const order = this.orders.get(cmd.orderId);
      if (!order) return events; // No-op if order doesn't exist

      const ob = this.orderbooks.get(order.market);
      if (!ob) return events;

      const cancelled = ob.cancelOrder(cmd.orderId);
      if (cancelled) {
        events.push({
          type: 'ORDER_CANCELLED',
          eventId: uuidv4(),
          sequenceNumber: this.nextSequence(),
          timestamp: Date.now(),
          market: cmd.market,
          orderId: order.id,
          userId: order.userId,
          side: order.side,
          priceTicks: order.priceTicks,
          remainingLots: cancelled.quantityLots - cancelled.filledLots,
          reason: 'user_request'
        });
      }
    }

    return events;
  }

  // Used for snapshots & API queries
  public getOrderbook(market: string): AggregatedBook | null {
    return this.orderbooks.get(market)?.getAggregatedBook() ?? null;
  }

  public getRawOrderbook(market: string): IOrderbook | null {
    return this.orderbooks.get(market) ?? null;
  }

  public getOrders(): Map<string, Order> {
    return this.orders;
  }

  public getQuote(market: string, side: OrderSide, quantityLots: number) {
    const ob = this.orderbooks.get(market);
    if (!ob) return null;
    return ob.getQuote(side, quantityLots);
  }

  // Restore state for crash recovery
  public restoreState(sequence: bigint, orders: Map<string, Order>) {
    this.sequenceCounter = sequence;
    this.orders = orders;
    
    const ordersArr = Array.from(orders.values());
    for (const [market, ob] of this.orderbooks.entries()) {
      const marketOrders = ordersArr.filter(o => o.market === market);
      ob.restoreState(marketOrders);
    }
  }
}
