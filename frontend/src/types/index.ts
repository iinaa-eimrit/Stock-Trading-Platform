export interface MarketInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastTradePrice: number | null;
}

export interface BookLevel {
  price: number;
  quantity: number;
}

export interface OrderbookData {
  bids: BookLevel[];
  asks: BookLevel[];
  lastTradePrice: number | null;
}

export interface TradeData {
  id: number;
  market: string;
  price: number;
  quantity: number;
  takerSide: 'buy' | 'sell';
  timestamp: number;
}

export interface CandleData {
  market: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PlaceOrderParams {
  type: 'limit' | 'market' | 'ioc';
  side: 'buy' | 'sell';
  price?: number;
  quantity: number;
  market: string;
}

export interface OrderData {
  id: string;
  userId: string;
  market: string;
  side: 'buy' | 'sell';
  type: string;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: string;
  createdAt: number;
}

export interface QuoteData {
  avgPrice: number;
  totalCost: number;
  totalQuantity: number;
  fills: { price: number; quantity: number }[];
}

export interface BalanceMap {
  [asset: string]: { available: number; locked: number };
}
