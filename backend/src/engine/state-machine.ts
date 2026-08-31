import { Order, OrderStatus } from './types';

const VALID_TRANSITIONS: Record<OrderStatus, Set<OrderStatus>> = {
  open: new Set(['partially_filled', 'filled', 'cancelled']),
  partially_filled: new Set(['partially_filled', 'filled', 'cancelled']),
  filled: new Set(),
  cancelled: new Set(),
};

export function updateOrderStatus(order: Order, newStatus: OrderStatus, filledQuantityIncrement: number = 0) {
  if (order.status === newStatus && filledQuantityIncrement === 0) {
    return; // No-op if same status and no fill increment
  }

  const allowed = VALID_TRANSITIONS[order.status];
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid state transition: ${order.status} -> ${newStatus}`);
  }

  order.status = newStatus;
  order.filledLots += filledQuantityIncrement;

  if (order.filledLots > order.quantityLots + 1e-8) {
    throw new Error(`Invalid fill: filledQuantity (${order.filledLots}) exceeds quantity (${order.quantityLots})`);
  }
}
