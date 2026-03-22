export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'ioc';
export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

export interface Order {
  id: string;
  userId: string;
  market: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: OrderStatus;
  createdAt: number;
}

export interface Trade {
  id: number;
  market: string;
  price: number;
  quantity: number;
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  timestamp: number;
  takerSide: OrderSide;
}

export interface AggregatedBookLevel {
  price: number;
  quantity: number;
}

export interface AggregatedBook {
  bids: AggregatedBookLevel[];
  asks: AggregatedBookLevel[];
  lastTradePrice: number | null;
}

export interface Candle {
  market: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface QuoteResult {
  avgPrice: number;
  totalCost: number;
  totalQuantity: number;
  fills: { price: number; quantity: number }[];
}

export interface MatchResult {
  trades: Trade[];
  order: Order;
}
