import { MatchingEngine } from '../engine/matching-engine';
import { IJournal } from '../journal/types';
import { Snapshot } from './snapshot';
import { Order } from '../engine/types';
import { ExchangeEvent } from '../events/types';

export class Replayer {
  constructor(private journal: IJournal) {}

  public async recoverEngine(engine: MatchingEngine, snapshot: Snapshot | null): Promise<void> {
    const activeOrders = new Map<string, Order>();
    let startSequence = 0n;

    // 1. Seed from Snapshot
    if (snapshot) {
      startSequence = snapshot.sequenceNumber;
      for (const order of snapshot.orders) {
        activeOrders.set(order.id, { ...order });
      }
    }

    // 2. Replay Journal events
    let currentSequence = startSequence;
    for await (const event of this.journal.readFrom(startSequence + 1n)) {
      this.applyEventToState(event, activeOrders);
      currentSequence = event.sequenceNumber;
    }

    // 3. Restore Engine State
    engine.restoreState(currentSequence, activeOrders);
  }

  private applyEventToState(event: ExchangeEvent, activeOrders: Map<string, Order>) {
    switch (event.type) {
      case 'ORDER_ACCEPTED':
        activeOrders.set(event.orderId, {
          id: event.orderId,
          clientOrderId: event.clientOrderId,
          userId: event.userId,
          market: event.market,
          side: event.side,
          type: event.orderType,
          priceTicks: event.priceTicks,
          quantityLots: event.quantityLots,
          filledLots: 0,
          status: 'open',
          sequenceNumber: event.sequenceNumber, // The order sequence number is the sequence of ACCEPTED
          createdAt: event.timestamp,
        });
        break;

      case 'ORDER_PARTIALLY_FILLED': {
        const order = activeOrders.get(event.orderId);
        if (order) {
          order.filledLots = event.filledLots;
          order.status = 'partially_filled';
        }
        break;
      }

      case 'ORDER_FILLED': {
        const order = activeOrders.get(event.orderId);
        if (order) {
          order.filledLots = event.filledLots;
          order.status = 'filled';
        }
        break;
      }

      case 'ORDER_CANCELLED': {
        const order = activeOrders.get(event.orderId);
        if (order) {
          order.status = 'cancelled';
        }
        break;
      }

      case 'TRADE_EXECUTED':
        // We track fills explicitly via ORDER_FILLED / ORDER_PARTIALLY_FILLED events,
        // so TRADE_EXECUTED doesn't strictly need to mutate the activeOrders map here.
        break;
    }
  }
}
