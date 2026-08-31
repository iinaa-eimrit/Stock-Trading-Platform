import { OrderSide, OrderType } from '../engine/types';

export type ExchangeEventType = 
  | 'ORDER_ACCEPTED' 
  | 'TRADE_EXECUTED' 
  | 'ORDER_PARTIALLY_FILLED' 
  | 'ORDER_FILLED' 
  | 'ORDER_CANCELLED';

export interface ExchangeEventBase {
  eventId: string;          // Unique persistence identifier
  sequenceNumber: bigint;   // Deterministic and authoritative for ordering and replay
  timestamp: number;        // Observational wall-clock metadata (not used for replay)
  market: string;
  type: ExchangeEventType;
}

export interface OrderAcceptedEvent extends ExchangeEventBase {
  type: 'ORDER_ACCEPTED';
  orderId: string;
  clientOrderId: string;
  userId: string;
  side: OrderSide;
  orderType: OrderType;
  priceTicks: number; // 0 for market orders
  quantityLots: number;
}

export interface TradeExecutedEvent extends ExchangeEventBase {
  type: 'TRADE_EXECUTED';
  tradeId: string;
  makerOrderId: string;
  makerUserId: string;
  takerOrderId: string;
  takerUserId: string;
  priceTicks: number;
  quantityLots: number;
  makerIsBuyer: boolean;
}

export interface OrderPartiallyFilledEvent extends ExchangeEventBase {
  type: 'ORDER_PARTIALLY_FILLED';
  orderId: string;
  userId: string;
  filledLots: number;
  remainingLots: number;
}

export interface OrderFilledEvent extends ExchangeEventBase {
  type: 'ORDER_FILLED';
  orderId: string;
  userId: string;
  filledLots: number;
}

export interface OrderCancelledEvent extends ExchangeEventBase {
  type: 'ORDER_CANCELLED';
  orderId: string;
  userId: string;
  side: OrderSide;
  priceTicks: number;
  remainingLots: number;
  reason: 'user_request' | 'ioc_no_fill' | 'market_no_liquidity' | 'SELF_TRADE_PREVENTION';
}

export type ExchangeEvent = 
  | OrderAcceptedEvent
  | TradeExecutedEvent
  | OrderPartiallyFilledEvent
  | OrderFilledEvent
  | OrderCancelledEvent;
