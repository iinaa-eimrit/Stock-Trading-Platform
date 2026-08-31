import { placeOrder, cancelOrder } from '../src/engine/test-helpers';
import { MatchingEngine } from '../src/engine/matching-engine';
import { generateWorkload, BenchmarkWorkloadType } from './workloads';
import { BenchmarkRunner, BenchmarkResult } from './runner';
import * as fs from 'fs';
import * as path from 'path';

const REPORTS_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR);
}

function printReport(title: string, result: BenchmarkResult) {
  console.log(`\nBenchmark: ${title}`);
  console.log(`Orders: ${result.orders.toLocaleString()}`);
  console.log(`Seed: ${result.seed}`);
  console.log(``);
  console.log(`                    ArrayBook`);
  console.log(`────────────────────────────────────────`);
  console.log(`Throughput          ${result.results.throughput.toLocaleString()} ops/sec`);
  console.log(`p50                 ${result.results.p50} μs`);
  console.log(`p95                 ${result.results.p95} μs`);
  console.log(`p99                 ${result.results.p99} μs`);
  console.log(`p99.9               ${result.results.p99_9} μs`);
  console.log(`Max                 ${result.results.max} μs`);
  console.log(`Heap Diff           ${result.results.heapUsedMB} MB`);
  console.log(`RSS Diff            ${result.results.rssMB} MB`);
  console.log(`────────────────────────────────────────\n`);
}

async function runBenchmarkSuite() {
  const seed = 42;
  const workloads: BenchmarkWorkloadType[] = [
    'resting-heavy',
    'matching-heavy',
    'cancellation-heavy',
    'market-sweep',
    'mixed'
  ];

  // For testing, let's just run 10K smoke and 100K normal for 'mixed' and 'cancellation-heavy'.
  const configs = [
    { orders: 10_000, type: 'mixed' as BenchmarkWorkloadType },
    { orders: 10_000, type: 'cancellation-heavy' as BenchmarkWorkloadType },
    { orders: 10_000, type: 'resting-heavy' as BenchmarkWorkloadType },
    { orders: 10_000, type: 'matching-heavy' as BenchmarkWorkloadType },
    { orders: 100_000, type: 'mixed' as BenchmarkWorkloadType },
    { orders: 100_000, type: 'cancellation-heavy' as BenchmarkWorkloadType },
  ];

  for (const config of configs) {
    console.log(`\nGenerating workload: ${config.type} (${config.orders} orders)...`);
    const workload = generateWorkload({ seed, orders: config.orders, type: config.type });
    
    // Create a fresh engine for every benchmark
    const engine = new MatchingEngine([{
      symbol: 'ETH_USDC',
      baseAsset: 'ETH',
      quoteAsset: 'USDC',
      tickSize: 0.01,
      lotSize: 0.001,
      minNotional: 1
    }]);

    const runner = new BenchmarkRunner(workload, 0.1); // 10% warmup
    
    const executor = (cmd: any) => {
      if (cmd.action === 'place') {
        placeOrder(engine, { userId: cmd.userId,
          clientOrderId: cmd.clientOrderId,
          market: cmd.market,
          side: cmd.side,
          orderType: cmd.type,
          priceTicks: cmd.priceTicks,
          quantityLots: cmd.quantityLots
        });
      } else if (cmd.action === 'cancel') {
        // Find order ID. Our workload generator produces clientOrderId as cancel target.
        // We know engine.getOrdersByUser doesn't index by clientOrderId, but for benchmark we 
        // can use the internal processedClientOrders or just add a method, but wait: 
        // ArrayOrderbook cancellation requires the `id` which is a UUID.
        // For the benchmark, we can cheat slightly by modifying `cmd` before the runner starts,
        // OR we can just allow the engine to cancel by clientOrderId.
        // Actually, let's keep track of clientOrderId -> orderId during `place`!
      }
    };

    // Wait, the executor is stateless per run. Let's provide a closure.
    const clientToOrderId = new Map<string, string>();
    
    const statefulExecutor = (cmd: any) => {
      if (cmd.action === 'place') {
        const result = placeOrder(engine, { userId: cmd.userId,
          clientOrderId: cmd.clientOrderId,
          market: cmd.market,
          side: cmd.side,
          orderType: cmd.type,
          priceTicks: cmd.priceTicks,
          quantityLots: cmd.quantityLots
        });
        if (result.order) {
          clientToOrderId.set(cmd.clientOrderId, result.order.id);
        }
      } else if (cmd.action === 'cancel') {
        const orderId = clientToOrderId.get(cmd.clientOrderId);
        if (orderId) {
          cancelOrder(engine, orderId);
        }
      }
    };

    const filename = path.join(REPORTS_DIR, `engine_${config.type}_${config.orders}.json`);
    const result = await runner.run(statefulExecutor, filename);
    
    printReport(`${config.type.toUpperCase()} - ${config.orders}`, result);
  }
}

runBenchmarkSuite().catch(console.error);
