import { MatchingEngine } from './matching-engine';
import { OrderSide, OrderType, Order } from './types';

export function placeOrder(
  engine: MatchingEngine,
  cmd: {
    userId: string;
    clientOrderId: string;
    market: string;
    side: OrderSide;
    orderType: OrderType;
    priceTicks: number;
    quantityLots: number;
  }
) {
  const events = engine.processCommand({
    type: 'PLACE_ORDER',
    ...cmd
  });
  
  const accepted = events.find(e => e.type === 'ORDER_ACCEPTED') as any;
  const orderId = accepted?.orderId;
  const order = orderId ? engine.getOrders().get(orderId) : undefined;
  
  const trades = events.filter(e => e.type === 'TRADE_EXECUTED').map((e: any) => {
    return {
      id: parseInt(e.tradeId),
      market: e.market,
      priceTicks: e.priceTicks,
      quantityLots: e.quantityLots,
      buyOrderId: e.makerIsBuyer ? e.makerOrderId : e.takerOrderId,
      sellOrderId: e.makerIsBuyer ? e.takerOrderId : e.makerOrderId,
      buyerId: e.makerIsBuyer ? e.makerUserId : e.takerUserId,
      sellerId: e.makerIsBuyer ? e.takerUserId : e.makerUserId,
      takerSide: e.makerIsBuyer ? 'sell' : 'buy'
    };
  });
  
  // Return the old MatchResult format for tests
  return { order, trades };
}

export function cancelOrder(engine: MatchingEngine, orderId: string, market: string = 'ETH_USDC', userId: string = 'u1') {
  const events = engine.processCommand({
    type: 'CANCEL_ORDER',
    market,
    userId,
    orderId
  });

  const cancelledEvent = events.find(e => e.type === 'ORDER_CANCELLED');
  if (cancelledEvent) {
    return engine.getOrders().get(orderId);
  }
  return null;
}
