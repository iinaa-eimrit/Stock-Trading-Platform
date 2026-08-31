import { SettlementStore } from '../accounting/types';
import { OrderSide, OrderType } from './types';
import { MarketConfig } from '../config';
import { lotsToBaseUnits, ticksAndLotsToQuoteUnits, UNIT_PRECISION } from '../utils/math';

export type RiskRejectionReason = 
  | 'INSUFFICIENT_BALANCE'
  | 'MAX_ORDER_QUANTITY'
  | 'MAX_NOTIONAL'
  | 'PRICE_BAND'
  | 'SELF_TRADE'
  | 'INVALID_MARKET'
  | 'INVALID_PRICE'
  | 'INVALID_QUANTITY';

export interface RiskApproved {
  status: 'approved';
}

export interface RiskRejected {
  status: 'rejected';
  reason: RiskRejectionReason;
}

export type RiskResult = RiskApproved | RiskRejected;

export class RiskEngine {
  constructor(private settlementStore: SettlementStore, private markets: Map<string, MarketConfig>) {}

  public validateOrder(params: {
    userId: string;
    market: string;
    side: OrderSide;
    type: OrderType;
    priceTicks: number;
    quantityLots: number;
  }): RiskResult {
    const marketConfig = this.markets.get(params.market);
    if (!marketConfig) {
      return { status: 'rejected', reason: 'INVALID_MARKET' };
    }

    if (params.quantityLots <= 0) {
      return { status: 'rejected', reason: 'INVALID_QUANTITY' };
    }

    if (params.type !== 'market' && params.priceTicks <= 0) {
      return { status: 'rejected', reason: 'INVALID_PRICE' };
    }

    const baseAmount = lotsToBaseUnits(params.quantityLots, marketConfig.lotSize);

    // Limit: reject orders larger than 1M base units
    if (baseAmount > 1_000_000 * UNIT_PRECISION) {
      return { status: 'rejected', reason: 'MAX_ORDER_QUANTITY' };
    }

    // Limit: max notional 10M quote units
    if (params.type !== 'market') {
      const quoteAmount = ticksAndLotsToQuoteUnits(params.priceTicks, params.quantityLots, marketConfig.tickSize, marketConfig.lotSize);
      if (quoteAmount > 10_000_000 * UNIT_PRECISION) {
        return { status: 'rejected', reason: 'MAX_NOTIONAL' };
      }
    }

    // Balance check
    const balanceCheck = this.checkBalance(params, marketConfig);
    if (balanceCheck.status === 'rejected') return balanceCheck;

    return { status: 'approved' };
  }

  private checkBalance(params: { userId: string; side: OrderSide; type: OrderType; priceTicks: number; quantityLots: number }, marketConfig: MarketConfig): RiskResult {
    if (params.side === 'buy') {
      if (params.type !== 'market') {
        const costUnits = ticksAndLotsToQuoteUnits(params.priceTicks, params.quantityLots, marketConfig.tickSize, marketConfig.lotSize);
        const bal = this.settlementStore.getBalance(params.userId, marketConfig.quoteAsset);
        if (bal.available < costUnits) {
          return { status: 'rejected', reason: 'INSUFFICIENT_BALANCE' };
        }
      }
    } else {
      const baseUnits = lotsToBaseUnits(params.quantityLots, marketConfig.lotSize);
      const bal = this.settlementStore.getBalance(params.userId, marketConfig.baseAsset);
      if (bal.available < baseUnits) {
        return { status: 'rejected', reason: 'INSUFFICIENT_BALANCE' };
      }
    }
    return { status: 'approved' };
  }
}
