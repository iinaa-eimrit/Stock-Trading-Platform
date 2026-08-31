import { Balance, SettlementStore } from './types';

export class InMemorySettlementStore implements SettlementStore {
  // Map of userId -> Map of asset -> Balance
  private balances = new Map<string, Map<string, Balance>>();

  /** Internal helper for testing or initial funding. */
  public deposit(userId: string, asset: string, amount: number): void {
    if (amount <= 0) throw new Error('Deposit amount must be positive');
    
    let userBalances = this.balances.get(userId);
    if (!userBalances) {
      userBalances = new Map<string, Balance>();
      this.balances.set(userId, userBalances);
    }
    
    let balance = userBalances.get(asset);
    if (!balance) {
      balance = { available: 0, locked: 0, total: 0 };
      userBalances.set(asset, balance);
    }

    balance.available += amount;
    balance.total += amount;
  }

  public reserve(userId: string, asset: string, amount: number): boolean {
    if (amount <= 0) return true; // Reserving 0 is technically successful

    const balance = this.getBalance(userId, asset);
    if (balance.available < amount) {
      return false; // Insufficient funds
    }

    balance.available -= amount;
    balance.locked += amount;
    // total remains unchanged
    return true;
  }

  public release(userId: string, asset: string, amount: number): void {
    if (amount <= 0) return;

    const balance = this.getBalance(userId, asset);
    if (balance.locked < amount) {
      // In a real system, you'd want to handle precision issues or over-releasing carefully.
      throw new Error(`Cannot release ${amount} ${asset}, only ${balance.locked} locked`);
    }

    balance.locked -= amount;
    balance.available += amount;
    // total remains unchanged
  }

  public settle(
    buyerId: string, 
    sellerId: string, 
    baseAsset: string, 
    quoteAsset: string, 
    baseAmount: number, // 8-decimal integer
    quoteAmount: number, // 8-decimal integer
    buyerFeeBase: number = 0,
    sellerFeeQuote: number = 0
  ): void {
    if (quoteAmount <= 0 || baseAmount <= 0) return;

    // The buyer must have reserved quoteAsset.
    // The seller must have reserved baseAsset.

    const buyerQuote = this.getBalance(buyerId, quoteAsset);
    const sellerBase = this.getBalance(sellerId, baseAsset);
    const buyerBase = this.getBalance(buyerId, baseAsset);
    const sellerQuote = this.getBalance(sellerId, quoteAsset);

    if (buyerQuote.locked < quoteAmount) throw new Error('Buyer does not have enough locked quote asset');
    if (sellerBase.locked < baseAmount) throw new Error('Seller does not have enough locked base asset');

    // 1. Deduct locked balances
    buyerQuote.locked -= quoteAmount;
    buyerQuote.total -= quoteAmount;

    sellerBase.locked -= baseAmount;
    sellerBase.total -= baseAmount;

    // 2. Add to available balances (minus fees)
    buyerBase.available += (baseAmount - buyerFeeBase);
    buyerBase.total += (baseAmount - buyerFeeBase);

    sellerQuote.available += (quoteAmount - sellerFeeQuote);
    sellerQuote.total += (quoteAmount - sellerFeeQuote);

    // 3. Credit fees to the exchange account
    if (buyerFeeBase > 0) {
      this.deposit('EXCHANGE', baseAsset, buyerFeeBase);
    }
    if (sellerFeeQuote > 0) {
      this.deposit('EXCHANGE', quoteAsset, sellerFeeQuote);
    }
  }

  public getBalance(userId: string, asset: string): Balance {
    let userBalances = this.balances.get(userId);
    if (!userBalances) {
      userBalances = new Map<string, Balance>();
      this.balances.set(userId, userBalances);
    }
    
    let balance = userBalances.get(asset);
    if (!balance) {
      balance = { available: 0, locked: 0, total: 0 };
      userBalances.set(asset, balance);
    }
    
    return balance;
  }

  public getAllBalances(userId: string): Record<string, Balance> {
    const userBalances = this.balances.get(userId);
    const result: Record<string, Balance> = {};
    if (userBalances) {
      for (const [asset, bal] of userBalances.entries()) {
        result[asset] = bal;
      }
    }
    return result;
  }
}
