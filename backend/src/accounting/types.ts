export interface Balance {
  available: number;
  locked: number;
  total: number; // total = available + locked
}

export interface SettlementStore {
  /** Reserves (locks) available funds for an open order. Returns false if insufficient. */
  reserve(userId: string, asset: string, amount: number): boolean;
  
  /** Releases (unlocks) funds back to available balance (e.g. on order cancellation). */
  release(userId: string, asset: string, amount: number): void;
  
  /** Executes the actual asset transfer between buyer and seller using locked funds. */
  settle(
    buyerId: string, 
    sellerId: string, 
    baseAsset: string, 
    quoteAsset: string, 
    baseAmount: number, // 8-decimal integer
    quoteAmount: number, // 8-decimal integer
    buyerFeeBase?: number,
    sellerFeeQuote?: number
  ): void;
  
  /** Gets the current balance for a user's asset. */
  getBalance(userId: string, asset: string): Balance;

  /** Gets all balances for a user. */
  getAllBalances(userId: string): Record<string, Balance>;
}
