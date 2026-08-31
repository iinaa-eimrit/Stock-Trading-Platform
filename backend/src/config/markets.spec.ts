import { describe, it, expect } from 'vitest';
import { MARKETS } from './index';

describe('Market Registry Consistency', () => {
  it('should have consistent market configurations for all consumers', () => {
    // This test ensures that the central MARKETS array contains the exact 
    // expected attributes for our production markets. 
    // Since Settlement, Matching, and Risk engines all import this directly,
    // they are guaranteed to see these exact same values.
    
    const ethMarket = MARKETS.find(m => m.symbol === 'ETH_USDC');
    expect(ethMarket).toBeDefined();
    expect(ethMarket).toEqual({
      symbol: 'ETH_USDC',
      baseAsset: 'ETH',
      quoteAsset: 'USDC',
      tickSize: 0.01,
      lotSize: 0.0001,
      minNotional: 1
    });

    const btcMarket = MARKETS.find(m => m.symbol === 'BTC_USDC');
    expect(btcMarket).toBeDefined();
    expect(btcMarket).toEqual({
      symbol: 'BTC_USDC',
      baseAsset: 'BTC',
      quoteAsset: 'USDC',
      tickSize: 0.01,
      lotSize: 0.00001,
      minNotional: 1
    });

    const solMarket = MARKETS.find(m => m.symbol === 'SOL_USDC');
    expect(solMarket).toBeDefined();
    expect(solMarket).toEqual({
      symbol: 'SOL_USDC',
      baseAsset: 'SOL',
      quoteAsset: 'USDC',
      tickSize: 0.01,
      lotSize: 0.001,
      minNotional: 1
    });
  });
});
