export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'ioc';
export type OrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled';

/**
 * Integer units representing price.
 * 1 PriceTick = marketConfig.tickSize
 * E.g., tickSize=0.01 USDC. Price = 102.50 -> PriceTicks = 10250
 */
export type PriceTicks = number;

/**
 * Integer units representing quantity.
 * 1 QuantityLot = marketConfig.lotSize
 * E.g., lotSize=0.001 BTC. Quantity = 0.125 -> QuantityLots = 125
 */
export type QuantityLots = number;

export interface Order {
  id: string;
  clientOrderId: string;
  userId: string;
  market: string;
  side: OrderSide;
  type: OrderType;
  priceTicks: PriceTicks;
  quantityLots: QuantityLots;
  filledLots: QuantityLots;
  status: OrderStatus;
  sequenceNumber: bigint;
  createdAt: number;
}

export interface Trade {
  id: number;
  market: string;
  priceTicks: PriceTicks;
  quantityLots: QuantityLots;
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  timestamp: number;
  takerSide: OrderSide;
}

export interface AggregatedBookLevel {
  priceTicks: PriceTicks;
  quantityLots: QuantityLots;
}

export interface AggregatedBook {
  bids: AggregatedBookLevel[];
  asks: AggregatedBookLevel[];
  lastTradePriceTicks: PriceTicks | null;
}

export interface Candle {
  market: string;
  openTicks: PriceTicks;
  highTicks: PriceTicks;
  lowTicks: PriceTicks;
  closeTicks: PriceTicks;
  volumeLots: QuantityLots;
  timestamp: number;
}

export interface QuoteResult {
  avgPriceTicks: PriceTicks;
  totalCostTicks: PriceTicks;
  totalLots: QuantityLots;
  fills: { priceTicks: PriceTicks; quantityLots: QuantityLots }[];
}

export interface MatchResult {
  trades: Trade[];
  order: Order;
}

export interface IOrderbook {
  readonly market: string;
  readonly lastTradePriceTicks: PriceTicks | null;

  addLimitOrder(order: Order, takerSide: OrderSide): Trade[];
  addMarketOrder(order: Order, takerSide: OrderSide): Trade[];
  cancelOrder(orderId: string): Order | null;
  getQuote(side: OrderSide, quantityLots: number): QuoteResult | null;
  getAggregatedBook(depth?: number): AggregatedBook;
  getOrder(orderId: string): Order | undefined;
  restoreState(orders: Order[]): void;
}

