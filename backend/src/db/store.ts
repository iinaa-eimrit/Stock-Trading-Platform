import bcrypt from 'bcryptjs';
import { INITIAL_BALANCES } from '../config';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  balances: Record<string, { available: number; locked: number }>;
}

class Store {
  private users = new Map<string, User>();
  private emailIndex = new Map<string, string>();

  async createUser(id: string, email: string, password: string): Promise<User> {
    if (this.emailIndex.has(email)) {
      throw new Error('Email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const balances: Record<string, { available: number; locked: number }> = {};
    for (const [asset, amount] of Object.entries(INITIAL_BALANCES)) {
      balances[asset] = { available: amount, locked: 0 };
    }

    const user: User = { id, email, passwordHash, balances };
    this.users.set(id, user);
    this.emailIndex.set(email, id);
    return user;
  }

  getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  getUserByEmail(email: string): User | undefined {
    const uid = this.emailIndex.get(email);
    return uid ? this.users.get(uid) : undefined;
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  lockFunds(userId: string, asset: string, amount: number): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    if (!user.balances[asset]) user.balances[asset] = { available: 0, locked: 0 };
    if (user.balances[asset].available < amount) return false;
    user.balances[asset].available -= amount;
    user.balances[asset].locked += amount;
    return true;
  }

  unlockFunds(userId: string, asset: string, amount: number): void {
    const user = this.users.get(userId);
    if (!user?.balances[asset]) return;
    const bal = user.balances[asset];
    const unlock = Math.min(amount, bal.locked);
    bal.locked -= unlock;
    bal.available += unlock;
  }

  public async settle(
    buyerId: string, 
    sellerId: string, 
    baseAsset: string, 
    quoteAsset: string, 
    baseAmount: number, // 8-decimal integer
    quoteAmount: number, // 8-decimal integer
    buyerFeeBase: number = 0,
    sellerFeeQuote: number = 0
  ): Promise<void> {
    if (quoteAmount <= 0 || baseAmount <= 0) return;

    // The buyer must have reserved quoteAsset.
    // The seller must have reserved baseAsset.

    const buyer = this.users.get(buyerId);
    const seller = this.users.get(sellerId);
    
    if (!buyer || !seller) return;

    if (!buyer.balances[quoteAsset]) buyer.balances[quoteAsset] = { available: 0, locked: 0 };
    if (!seller.balances[baseAsset]) seller.balances[baseAsset] = { available: 0, locked: 0 };
    if (!buyer.balances[baseAsset]) buyer.balances[baseAsset] = { available: 0, locked: 0 };
    if (!seller.balances[quoteAsset]) seller.balances[quoteAsset] = { available: 0, locked: 0 };

    if (buyer.balances[quoteAsset].locked < quoteAmount) throw new Error('Buyer does not have enough locked quote asset');
    if (seller.balances[baseAsset].locked < baseAmount) throw new Error('Seller does not have enough locked base asset');

    // 1. Deduct locked balances
    buyer.balances[quoteAsset].locked -= quoteAmount;
    seller.balances[baseAsset].locked -= baseAmount;

    // 2. Add to available balances (minus fees)
    buyer.balances[baseAsset].available += (baseAmount - buyerFeeBase);
    seller.balances[quoteAsset].available += (quoteAmount - sellerFeeQuote);
  }

  getAllBalances(userId: string): Record<string, { available: number; locked: number }> {
    const user = this.users.get(userId);
    if (!user) return {};
    // Return a shallow copy per asset
    const out: Record<string, { available: number; locked: number }> = {};
    for (const [k, v] of Object.entries(user.balances)) {
      out[k] = { available: parseFloat(v.available.toFixed(8)), locked: parseFloat(v.locked.toFixed(8)) };
    }
    return out;
  }
}

export const store = new Store();
