import { writeFileSync } from 'fs';
import * as os from 'os';
import { GeneratedWorkload, BenchmarkCommand } from './workloads';

export interface BenchmarkResult {
  commit?: string; // Optional for now, could be fetched via git
  node: string;
  platform: string;
  arch: string;
  cpu: string;
  workload: string;
  seed: number;
  orders: number;
  warmup: number;
  results: {
    throughput: number;
    p50: number;
    p95: number;
    p99: number;
    p99_9: number;
    max: number;
    heapUsedMB: number;
    rssMB: number;
  };
}

export type BenchmarkExecutor = (command: BenchmarkCommand) => void;

export class BenchmarkRunner {
  private latencies: bigint[] = [];

  constructor(
    private workload: GeneratedWorkload,
    private warmupRatio = 0.1
  ) {}

  public async run(executor: BenchmarkExecutor, outputFilename?: string): Promise<BenchmarkResult> {
    const totalCommands = this.workload.commands.length;
    const warmupCount = Math.floor(totalCommands * this.warmupRatio);
    const measureCount = totalCommands - warmupCount;

    // 1. Warmup
    console.log(`Warming up with ${warmupCount} commands...`);
    for (let i = 0; i < warmupCount; i++) {
      executor(this.workload.commands[i]);
    }

    // Attempt GC if exposed
    if (global.gc) {
      global.gc();
    }

    // 2. Measure Memory Before
    const memBefore = process.memoryUsage();

    // 3. Measure Execution
    console.log(`Executing ${measureCount} commands...`);
    this.latencies = new Array(measureCount);

    const startTotal = process.hrtime.bigint();
    
    for (let i = 0; i < measureCount; i++) {
      const cmd = this.workload.commands[warmupCount + i];
      const startOp = process.hrtime.bigint();
      
      executor(cmd);
      
      const endOp = process.hrtime.bigint();
      this.latencies[i] = endOp - startOp;
    }
    
    const endTotal = process.hrtime.bigint();
    const elapsedSecs = Number(endTotal - startTotal) / 1_000_000_000;

    // 4. Measure Memory After
    const memAfter = process.memoryUsage();
    const heapUsedMB = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
    const rssMB = (memAfter.rss - memBefore.rss) / 1024 / 1024;

    // 5. Calculate Percentiles
    // Convert BigInt nanoseconds to Number microseconds
    const sortedMicros = this.latencies
      .map(b => Number(b) / 1000)
      .sort((a, b) => a - b);

    const p50 = sortedMicros[Math.floor(measureCount * 0.50)];
    const p95 = sortedMicros[Math.floor(measureCount * 0.95)];
    const p99 = sortedMicros[Math.floor(measureCount * 0.99)];
    const p99_9 = sortedMicros[Math.floor(measureCount * 0.999)];
    const max = sortedMicros[measureCount - 1];

    const throughput = measureCount / elapsedSecs;

    const result: BenchmarkResult = {
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      workload: this.workload.config.type,
      seed: this.workload.config.seed,
      orders: totalCommands,
      warmup: warmupCount,
      results: {
        throughput: Math.round(throughput),
        p50: Number(p50.toFixed(2)),
        p95: Number(p95.toFixed(2)),
        p99: Number(p99.toFixed(2)),
        p99_9: Number(p99_9.toFixed(2)),
        max: Number(max.toFixed(2)),
        heapUsedMB: Number(heapUsedMB.toFixed(2)),
        rssMB: Number(rssMB.toFixed(2))
      }
    };

    if (outputFilename) {
      writeFileSync(outputFilename, JSON.stringify(result, null, 2));
      console.log(`Report written to ${outputFilename}`);
    }

    return result;
  }
}
