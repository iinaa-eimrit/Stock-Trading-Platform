import { OrderSide, OrderType } from '../engine/types';

export type CommandType = 'PLACE_ORDER' | 'CANCEL_ORDER';

export interface CommandBase {
  type: CommandType;
  market: string;
}

export interface PlaceOrderCommand extends CommandBase {
  type: 'PLACE_ORDER';
  clientOrderId: string;
  userId: string;
  side: OrderSide;
  orderType: OrderType;
  priceTicks: number;
  quantityLots: number;
}

export interface CancelOrderCommand extends CommandBase {
  type: 'CANCEL_ORDER';
  orderId: string;
  userId: string;
}

export type ExchangeCommand = PlaceOrderCommand | CancelOrderCommand;
