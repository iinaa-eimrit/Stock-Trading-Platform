export const PORT = parseInt(process.env.PORT || '3001', 10);
export const JWT_SECRET = process.env.JWT_SECRET || 'exchange-dev-secret-change-in-production';

export interface MarketConfig {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  lotSize: number;
  minNotional: number;
}

export const MARKETS: MarketConfig[] = [
  { symbol: 'ETH_USDC', baseAsset: 'ETH', quoteAsset: 'USDC', tickSize: 0.01, lotSize: 0.0001, minNotional: 1 },
  { symbol: 'BTC_USDC', baseAsset: 'BTC', quoteAsset: 'USDC', tickSize: 0.01, lotSize: 0.00001, minNotional: 1 },
  { symbol: 'TATA_INR', baseAsset: 'TATA', quoteAsset: 'INR', tickSize: 0.05, lotSize: 1, minNotional: 10 },
  { symbol: 'SOL_USDC', baseAsset: 'SOL', quoteAsset: 'USDC', tickSize: 0.01, lotSize: 0.001, minNotional: 1 },
];

export const MARKET_MAKER_CONFIGS = [
  {
    market: 'ETH_USDC',
    basePrice: 2500,
    spread: 0.002,
    levels: 15,
    levelStep: 0.001,
    baseQuantity: 2,
    refreshInterval: 3000,
  },
  {
    market: 'BTC_USDC',
    basePrice: 65000,
    spread: 0.002,
    levels: 15,
    levelStep: 0.001,
    baseQuantity: 0.2,
    refreshInterval: 3000,
  },
  {
    market: 'TATA_INR',
    basePrice: 1800,
    spread: 0.003,
    levels: 15,
    levelStep: 0.001,
    baseQuantity: 50,
    refreshInterval: 3000,
  },
  {
    market: 'SOL_USDC',
    basePrice: 150,
    spread: 0.002,
    levels: 15,
    levelStep: 0.001,
    baseQuantity: 10,
    refreshInterval: 3000,
  },
];

export const INITIAL_BALANCES: Record<string, number> = {
  USDC: 1_000_000,
  ETH: 100,
  BTC: 10,
  INR: 10_000_000,
  TATA: 10_000,
  SOL: 1000,
};

export const MARKET_MAKER_USER_ID = '__market_maker__';
