import { OrderSide, OrderType } from '../src/engine/types';

// Linear Congruential Generator for deterministic random numbers
function createPRNG(seed: number) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export type BenchmarkWorkloadType = 'resting-heavy' | 'matching-heavy' | 'cancellation-heavy' | 'market-sweep' | 'mixed';

export interface PlaceCommand {
  action: 'place';
  userId: string;
  clientOrderId: string;
  market: string;
  side: OrderSide;
  type: OrderType;
  priceTicks: number;
  quantityLots: number;
}

export interface CancelCommand {
  action: 'cancel';
  userId: string;
  orderId: string;
}

export type BenchmarkCommand = PlaceCommand | CancelCommand;

export interface WorkloadConfiguration {
  seed: number;
  orders: number;
  type: BenchmarkWorkloadType;
}

export interface GeneratedWorkload {
  config: WorkloadConfiguration;
  commands: BenchmarkCommand[];
}

export function generateWorkload(config: WorkloadConfiguration): GeneratedWorkload {
  const random = createPRNG(config.seed);
  const commands: BenchmarkCommand[] = [];
  const activeClientOrderIds: string[] = [];

  let placedCount = 0;
  const targetOrders = config.orders;
  const market = 'ETH_USDC';
  const basePrice = 3000;

  for (let i = 0; i < targetOrders; i++) {
    const clientOrderId = `order_${i}`;
    const rand = random();

    // Determine action based on workload type
    let isCancel = false;
    if (config.type === 'resting-heavy') {
      isCancel = rand < 0.1 && activeClientOrderIds.length > 0;
    } else if (config.type === 'cancellation-heavy') {
      isCancel = rand < 0.7 && activeClientOrderIds.length > 0;
    } else if (config.type === 'mixed') {
      isCancel = rand < 0.3 && activeClientOrderIds.length > 0;
    }

    if (isCancel) {
      // Pick a random active order to cancel
      const idx = Math.floor(random() * activeClientOrderIds.length);
      const cancelTarget = activeClientOrderIds[idx];
      activeClientOrderIds.splice(idx, 1);

      commands.push({
        action: 'cancel',
        userId: 'benchmark_user',
        orderId: cancelTarget
      });
      continue;
    }

    // Otherwise, place an order
    placedCount++;
    const side: OrderSide = random() < 0.5 ? 'buy' : 'sell';
    let type: OrderType = 'limit';
    
    // Market sweep uses deep book and large market orders
    if (config.type === 'market-sweep') {
      if (placedCount % 100 === 0) {
        type = 'market';
      }
    } else if (config.type === 'mixed') {
      if (random() < 0.05) type = 'market';
      else if (random() < 0.1) type = 'ioc';
    }

    // Generate spread based on workload
    let priceSpread = 0;
    if (config.type === 'matching-heavy' || config.type === 'mixed' || type === 'market' || type === 'ioc') {
      priceSpread = Math.floor(random() * 20) - 10; // -10 to +9, tight spread for matching
    } else {
      // Wide spread for resting/cancellation so they don't match
      priceSpread = side === 'buy' ? -Math.floor(random() * 500) - 10 : Math.floor(random() * 500) + 10;
    }

    const price = Math.max(1, basePrice + priceSpread);
    const quantity = Math.max(0.1, Number((random() * 2).toFixed(2))); // 0.1 to 2.0

    const userId = `benchmark_user_${Math.floor(random() * 100)}`;
    commands.push({
      action: 'place',
      userId,
      clientOrderId,
      market,
      side,
      type,
      priceTicks: type === 'market' ? 0 : price,
      quantityLots: quantity
    });

    if (type === 'limit') {
      activeClientOrderIds.push(clientOrderId);
    }
  }

  return {
    config,
    commands
  };
}
