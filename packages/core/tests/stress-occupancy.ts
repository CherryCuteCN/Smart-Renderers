import { cpus } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { createRuntime } from "../src/index";
import type { Clock, IdleSource, Runtime } from "../src/index";

const TARGET_SCALES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000];
const CONCURRENCY = 64;
const HAMMER_MS = 1_000;
const SNAPSHOT_SAMPLES = 30;
const MAX_WALL_MS = 15_000;

type FakeClock = Clock & { flush: () => void };

type FakeIdle = IdleSource & {
  emitPower: () => void;
};

type Mem = {
  rssMb: number;
  heapMb: number;
  externalMb: number;
};

type Cpu = {
  userMs: number;
  systemMs: number;
  wallMs: number;
  oneCorePercent: number;
};

function createFakeClock(): FakeClock {
  const now = 0;
  let seq = 0;
  const timers = new Map<
    number,
    {
      at: number;
      fn: () => void;
    }
  >();

  function flush(): void {
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (due.length === 0) {
        return;
      }
      for (const [id] of due) {
        timers.delete(id);
      }
      for (const [, timer] of due) {
        timer.fn();
      }
    }
  }

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return () => {
        timers.delete(id);
      };
    },
    flush,
  };
}

function createFakeIdle(): FakeIdle {
  const listeners = new Set<() => void>();
  return {
    getIdleTimeSeconds: () => 0,
    getIdleState: () => "active",
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emitPower() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function mem(): Mem {
  const usage = process.memoryUsage();
  return {
    rssMb: roundMb(usage.rss),
    heapMb: roundMb(usage.heapUsed),
    externalMb: roundMb(usage.external),
  };
}

function roundMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function cpuOf(start: NodeJS.CpuUsage, wallMs: number): Cpu {
  const usage = process.cpuUsage(start);
  const userMs = usage.user / 1000;
  const systemMs = usage.system / 1000;
  return {
    userMs: roundMs(userMs),
    systemMs: roundMs(systemMs),
    wallMs: roundMs(wallMs),
    oneCorePercent: roundMs(((userMs + systemMs) / wallMs) * 100),
  };
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function collectGc(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `p-${index}`);
}

function setup(
  count: number,
  idleAfterMs: number,
): {
  runtime: Runtime;
  clock: FakeClock;
  idle: FakeIdle;
  targetIds: string[];
} {
  const clock = createFakeClock();
  const idle = createFakeIdle();
  const runtime = createRuntime({
    clock,
    idle,
    idleAfterMs,
    countdownMs: 15 * 60 * 1000,
  });
  const targetIds = ids(count);
  for (const [index, id] of targetIds.entries()) {
    runtime.track({ id, pid: 1000 + index, kind: "window" });
  }
  return { runtime, clock, idle, targetIds };
}

function timed<T>(fn: () => T): { value: T; wallMs: number; cpu: Cpu; memory: Mem } {
  collectGc();
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const value = fn();
  const wallMs = performance.now() - wallStart;
  return { value, wallMs: roundMs(wallMs), cpu: cpuOf(cpuStart, wallMs), memory: mem() };
}

async function hammer(
  runtime: Runtime,
  targetIds: string[],
  idle: FakeIdle,
): Promise<{ ops: number; snapshots: number; cpu: Cpu; memory: Mem; loopP99Ms: number }> {
  const histogram = monitorEventLoopDelay({ resolution: 4 });
  histogram.enable();
  collectGc();
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const stopAt = wallStart + HAMMER_MS;
  let ops = 0;
  let snapshots = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, worker) => {
      let cursor = worker;
      let localOps = 0;
      while (performance.now() < stopAt) {
        const id = targetIds[cursor % targetIds.length];
        if (id) {
          runtime.reportActivity(id);
          ops += 1;
          localOps += 1;
        }
        if (worker === 0 && localOps % 64 === 0) {
          runtime.getSnapshot();
          snapshots += 1;
          ops += 1;
        }
        if (worker === 1 && localOps % 256 === 0) {
          idle.emitPower();
          ops += 1;
        }
        cursor += CONCURRENCY;
        if (localOps % 128 === 0) {
          await Promise.resolve();
        }
      }
    }),
  );

  const wallMs = performance.now() - wallStart;
  histogram.disable();
  return {
    ops,
    snapshots,
    cpu: cpuOf(cpuStart, wallMs),
    memory: mem(),
    loopP99Ms: roundMs(histogram.percentile(99) / 1e6),
  };
}

async function runScale(count: number): Promise<boolean> {
  console.log(`\n=== ${count.toLocaleString("en-US")} tracked processes / ${CONCURRENCY} concurrent workers ===`);

  const inventory = timed(() => {
    const ctx = setup(count, 60 * 60 * 1000);
    const snapshot = ctx.runtime.getSnapshot();
    return { ctx, snapshotCount: snapshot.targets.length };
  });
  if (inventory.wallMs > MAX_WALL_MS) {
    console.log("stop: track+snapshot exceeded budget", inventory);
    inventory.value.ctx.runtime.dispose();
    return false;
  }

  const snapshotSamples: number[] = [];
  const snapshotCpuStart = process.cpuUsage();
  const snapshotWallStart = performance.now();
  for (let index = 0; index < SNAPSHOT_SAMPLES; index += 1) {
    const started = performance.now();
    inventory.value.ctx.runtime.getSnapshot();
    snapshotSamples.push(performance.now() - started);
  }
  const snapshotCpu = cpuOf(snapshotCpuStart, performance.now() - snapshotWallStart);
  snapshotSamples.sort((a, b) => a - b);
  const snapshotP50 = snapshotSamples[Math.floor(snapshotSamples.length * 0.5)] ?? 0;
  const snapshotP99 = snapshotSamples[Math.floor(snapshotSamples.length * 0.99)] ?? 0;

  const mixed = await hammer(
    inventory.value.ctx.runtime,
    inventory.value.ctx.targetIds,
    inventory.value.ctx.idle,
  );
  inventory.value.ctx.runtime.dispose();

  let countdownFlush: {
    wallMs: number;
    cpu: Cpu;
    memory: Mem;
    idleCount: number | null;
    skipped?: boolean;
  };
  if (count > 10_000) {
    countdownFlush = {
      wallMs: 0,
      cpu: { userMs: 0, systemMs: 0, wallMs: 0, oneCorePercent: 0 },
      memory: mem(),
      idleCount: null,
      skipped: true,
    };
  } else {
    const countdown = timed(() => {
      const ctx = setup(count, 0);
      ctx.clock.flush();
      const snapshot = ctx.runtime.getSnapshot();
      ctx.runtime.dispose();
      return snapshot.aggregate;
    });
    countdownFlush = {
      wallMs: countdown.wallMs,
      cpu: countdown.cpu,
      memory: countdown.memory,
      idleCount: countdown.value.idleCount,
    };
  }

  console.log(
    JSON.stringify(
      {
        processes: count,
        concurrency: CONCURRENCY,
        track: {
          wallMs: inventory.wallMs,
          cpu: inventory.cpu,
          memory: inventory.memory,
        },
        snapshotMs: {
          p50: roundMs(snapshotP50),
          p99: roundMs(snapshotP99),
          cpu: snapshotCpu,
        },
        mixed1s: {
          ops: mixed.ops,
          opsPerSec: Math.round(mixed.ops / (mixed.cpu.wallMs / 1000)),
          snapshots: mixed.snapshots,
          loopP99Ms: mixed.loopP99Ms,
          cpu: mixed.cpu,
          memory: mixed.memory,
        },
        countdownFlush,
      },
      null,
      2,
    ),
  );

  return (
    (countdownFlush.skipped || countdownFlush.wallMs <= MAX_WALL_MS) &&
    mixed.cpu.wallMs <= MAX_WALL_MS
  );
}

async function main(): Promise<void> {
  process.env.UV_THREADPOOL_SIZE = "1";
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        hostCores: cpus().length,
        jsThreads: 1,
        uvThreadpool: process.env.UV_THREADPOOL_SIZE,
        exposeGc: typeof globalThis.gc === "function",
        note: "Electron main/core is one JS thread. Occupancy is that one core.",
      },
      null,
      2,
    ),
  );

  for (const count of TARGET_SCALES) {
    const keepGoing = await runScale(count);
    if (!keepGoing) {
      console.log(`limit reached at ${count.toLocaleString("en-US")} processes`);
      break;
    }
  }
}

await main();
