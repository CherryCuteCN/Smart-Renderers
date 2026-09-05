import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { createRuntime } from "../../core/src/index";
import { createManager } from "../src/index";
import type { Clock, IdleSource, Runtime } from "../../core/src/index";
import type { ActionPort, Manager } from "../src/index";

const TARGET_SCALES = [500, 1_000, 2_500, 5_000, 10_000, 25_000];
const MAX_EXPIRE_TARGETS = 2_500;
const CONCURRENCY_SWEEP = [1, 8, 32, 64, 256];
const DEFAULT_CONCURRENCY = 64;
const HAMMER_MS = 1_000;
const SNAPSHOT_SAMPLES = 20;
const MAX_PHASE_MS = 20_000;
const SHARD_COUNT = Math.min(4, Math.max(1, cpus().length));
const SHARD_TARGETS = 1_000;

type FakeClock = Clock & { flush: () => void };
type FakeIdle = IdleSource & {
  setIdleTimeSeconds: (seconds: number) => void;
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

type CountingPort = ActionPort & {
  applied: number;
  reverted: number;
};

type Pipeline = {
  runtime: Runtime;
  manager: Manager;
  clock: FakeClock;
  idle: FakeIdle;
  port: CountingPort;
  targetIds: string[];
};

type Phase = {
  wallMs: number;
  cpu: Cpu;
  memory: Mem;
};

type ShardResult = {
  targets: number;
  expireApply: Phase & { applied: number };
};

const CAPABLE_HOST = {
  getAvailability: () => ({
    electron: true,
    processType: "browser" as const,
    rendererCapable: true,
  }),
};

function createFakeClock(): FakeClock {
  const now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();

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

function createFakeIdle(initialSeconds = 0): FakeIdle {
  let idleTimeSeconds = initialSeconds;
  const listeners = new Set<() => void>();
  return {
    getIdleTimeSeconds: () => idleTimeSeconds,
    getIdleState: (thresholdSeconds) =>
      idleTimeSeconds >= thresholdSeconds ? "idle" : "active",
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setIdleTimeSeconds(seconds) {
      idleTimeSeconds = seconds;
    },
    emitPower() {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

function createCountingPort(asyncApply: boolean): CountingPort {
  const port: CountingPort = {
    applied: 0,
    reverted: 0,
    apply() {
      if (asyncApply) {
        return Promise.resolve().then(() => {
          port.applied += 1;
        });
      }
      port.applied += 1;
    },
    revert() {
      port.reverted += 1;
    },
  };
  return port;
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

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function cpuOf(start: NodeJS.CpuUsage, wallMs: number): Cpu {
  const usage = process.cpuUsage(start);
  const userMs = usage.user / 1000;
  const systemMs = usage.system / 1000;
  return {
    userMs: roundMs(userMs),
    systemMs: roundMs(systemMs),
    wallMs: roundMs(wallMs),
    oneCorePercent: wallMs <= 0 ? 0 : roundMs(((userMs + systemMs) / wallMs) * 100),
  };
}

function collectGc(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `p-${index}`);
}

function setup(count: number, idleAfterMs: number, asyncApply = false): Pipeline {
  const clock = createFakeClock();
  const idle = createFakeIdle();
  const port = createCountingPort(asyncApply);
  const runtime = createRuntime({
    clock,
    idle,
    idleAfterMs,
    countdownMs: 1_000,
    host: CAPABLE_HOST,
  });
  const manager = createManager({
    runtime,
    actions: port,
    operators: [
      {
        name: "counter",
        interestedIn: [
          "countdown.started",
          "countdown.cancelled",
          "countdown.expired",
        ],
        handle() {
          return;
        },
      },
    ],
  });
  const targetIds = ids(count);
  for (const [index, id] of targetIds.entries()) {
    runtime.track({ id, pid: 1000 + index, kind: "window" });
  }
  return { runtime, manager, clock, idle, port, targetIds };
}

function disposePipeline(pipeline: Pipeline): void {
  pipeline.manager.dispose();
  pipeline.runtime.dispose();
}

function timed<T>(fn: () => T): Phase & { value: T } {
  collectGc();
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const value = fn();
  const wallMs = performance.now() - wallStart;
  return { value, wallMs: roundMs(wallMs), cpu: cpuOf(cpuStart, wallMs), memory: mem() };
}

function phaseOf<T>(result: Phase & { value: T }): Phase {
  return { wallMs: result.wallMs, cpu: result.cpu, memory: result.memory };
}

async function drain(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function hammer(
  pipeline: Pipeline,
  concurrency: number,
): Promise<{
  ops: number;
  snapshots: number;
  appliedReads: number;
  opsPerSec: number;
  loopP99Ms: number;
  cpu: Cpu;
  memory: Mem;
}> {
  const histogram = monitorEventLoopDelay({ resolution: 4 });
  histogram.enable();
  collectGc();
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  const stopAt = wallStart + HAMMER_MS;
  let ops = 0;
  let snapshots = 0;
  let appliedReads = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async (_, worker) => {
      let cursor = worker;
      let localOps = 0;
      while (performance.now() < stopAt) {
        const id = pipeline.targetIds[cursor % pipeline.targetIds.length];
        if (id) {
          pipeline.runtime.reportActivity(id);
          ops += 1;
          localOps += 1;
        }
        if (worker === 0 && localOps % 64 === 0) {
          pipeline.runtime.getSnapshot();
          snapshots += 1;
          ops += 1;
        }
        if (worker === 1 && localOps % 64 === 0) {
          pipeline.manager.getApplied();
          appliedReads += 1;
          ops += 1;
        }
        if (worker === 2 && localOps % 256 === 0) {
          pipeline.idle.emitPower();
          ops += 1;
        }
        cursor += concurrency;
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
    appliedReads,
    opsPerSec: Math.round(ops / (wallMs / 1000)),
    loopP99Ms: roundMs(histogram.percentile(99) / 1e6),
    cpu: cpuOf(cpuStart, wallMs),
    memory: mem(),
  };
}

async function expireApplyRevert(
  count: number,
  asyncApply: boolean,
): Promise<{
  countdownStarted: Phase;
  expireApply: Phase & { applied: number; appliedPerSec: number };
  revert: Phase & { reverted: number; revertedPerSec: number };
}> {
  const pipeline = setup(count, 0, asyncApply);
  const countdownStarted = phaseOf(
    timed(() => {
      pipeline.clock.flush();
    }),
  );
  collectGc();
  const expireCpuStart = process.cpuUsage();
  const expireWallStart = performance.now();
  pipeline.idle.setIdleTimeSeconds(1);
  pipeline.idle.emitPower();
  if (asyncApply) {
    await drain();
  }
  const expireApply = {
    wallMs: roundMs(performance.now() - expireWallStart),
    cpu: cpuOf(expireCpuStart, performance.now() - expireWallStart),
    memory: mem(),
  };
  const revert = phaseOf(
    timed(() => {
      for (const id of pipeline.targetIds) {
        pipeline.runtime.reportActivity(id);
      }
    }),
  );
  const applied = pipeline.port.applied;
  const reverted = pipeline.port.reverted;
  disposePipeline(pipeline);
  return {
    countdownStarted,
    expireApply: {
      ...expireApply,
      applied,
      appliedPerSec:
        expireApply.wallMs <= 0
          ? applied
          : Math.round(applied / (expireApply.wallMs / 1000)),
    },
    revert: {
      ...revert,
      reverted,
      revertedPerSec:
        revert.wallMs <= 0 ? reverted : Math.round(reverted / (revert.wallMs / 1000)),
    },
  };
}

async function runScale(count: number): Promise<boolean> {
  console.log(`\n=== ${count.toLocaleString("en-US")} targets / core+manager pipeline ===`);

  const tracked = timed(() => {
    const pipeline = setup(count, 60 * 60 * 1000);
    pipeline.runtime.getSnapshot();
    return pipeline;
  });
  if (tracked.wallMs > MAX_PHASE_MS) {
    console.log("stop: track+snapshot exceeded budget", tracked);
    disposePipeline(tracked.value);
    return false;
  }

  const snapshotSamples: number[] = [];
  const snapshotCpuStart = process.cpuUsage();
  const snapshotWallStart = performance.now();
  for (let index = 0; index < SNAPSHOT_SAMPLES; index += 1) {
    const started = performance.now();
    tracked.value.runtime.getSnapshot();
    snapshotSamples.push(performance.now() - started);
  }
  const snapshotCpu = cpuOf(snapshotCpuStart, performance.now() - snapshotWallStart);
  snapshotSamples.sort((a, b) => a - b);
  const snapshotP50 = snapshotSamples[Math.floor(snapshotSamples.length * 0.5)] ?? 0;
  const snapshotP99 = snapshotSamples[Math.floor(snapshotSamples.length * 0.99)] ?? 0;

  const mixed = await hammer(tracked.value, DEFAULT_CONCURRENCY);
  disposePipeline(tracked.value);

  let pipeline:
    | Awaited<ReturnType<typeof expireApplyRevert>>
    | { skipped: true; reason: string }
    | undefined;
  if (count > MAX_EXPIRE_TARGETS) {
    pipeline = {
      skipped: true,
      reason: `expire-all skipped above ${MAX_EXPIRE_TARGETS} (snapshot-per-event is O(n^2) and OOMs)`,
    };
  } else {
    pipeline = await expireApplyRevert(count, false);
  }

  const keepGoing = mixed.cpu.wallMs <= MAX_PHASE_MS && tracked.wallMs <= MAX_PHASE_MS;

  console.log(
    JSON.stringify(
      {
        targets: count,
        jsThreads: 1,
        concurrency: DEFAULT_CONCURRENCY,
        track: {
          wallMs: tracked.wallMs,
          cpu: tracked.cpu,
          memory: tracked.memory,
        },
        snapshotMs: {
          p50: roundMs(snapshotP50),
          p99: roundMs(snapshotP99),
          cpu: snapshotCpu,
        },
        mixed1s: mixed,
        expirePipeline: pipeline,
      },
      null,
      2,
    ),
  );

  return keepGoing;
}

async function runConcurrencySweep(): Promise<void> {
  const count = 2_500;
  console.log(`\n=== concurrency sweep @ ${count.toLocaleString("en-US")} active targets ===`);
  const rows = [];
  for (const concurrency of CONCURRENCY_SWEEP) {
    const pipeline = setup(count, 60 * 60 * 1000);
    const mixed = await hammer(pipeline, concurrency);
    disposePipeline(pipeline);
    rows.push({
      concurrency,
      opsPerSec: mixed.opsPerSec,
      loopP99Ms: mixed.loopP99Ms,
      oneCorePercent: mixed.cpu.oneCorePercent,
      heapMb: mixed.memory.heapMb,
    });
  }
  console.log(JSON.stringify({ targets: count, rows }, null, 2));
}

async function runAsyncCompare(): Promise<void> {
  const count = 2_500;
  console.log(`\n=== sync vs async apply @ ${count.toLocaleString("en-US")} expires ===`);
  const sync = await expireApplyRevert(count, false);
  const asyncApply = await expireApplyRevert(count, true);
  console.log(
    JSON.stringify(
      {
        targets: count,
        sync: sync.expireApply,
        asyncApply: asyncApply.expireApply,
      },
      null,
      2,
    ),
  );
}

function runShardProcess(count: number): Promise<ShardResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        "--shard",
        `--count=${count}`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let out = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`shard exited ${code}: ${out}`));
        return;
      }
      try {
        resolve(JSON.parse(out) as ShardResult);
      } catch {
        reject(new Error(`bad shard output: ${out}`));
      }
    });
  });
}

async function runParallelShards(): Promise<void> {
  console.log(
    `\n=== multi-process shards ${SHARD_COUNT} x ${SHARD_TARGETS.toLocaleString("en-US")} vs sequential ${SHARD_COUNT} x ${SHARD_TARGETS.toLocaleString("en-US")} ===`,
  );

  collectGc();
  const sequentialCpuStart = process.cpuUsage();
  const sequentialWallStart = performance.now();
  const sequential: Awaited<ReturnType<typeof expireApplyRevert>>[] = [];
  for (let index = 0; index < SHARD_COUNT; index += 1) {
    sequential.push(await expireApplyRevert(SHARD_TARGETS, false));
  }
  const sequentialWallMs = performance.now() - sequentialWallStart;
  const sequentialCpu = cpuOf(sequentialCpuStart, sequentialWallMs);

  collectGc();
  const parallelCpuStart = process.cpuUsage();
  const parallelWallStart = performance.now();
  const shards = await Promise.all(
    Array.from({ length: SHARD_COUNT }, () => runShardProcess(SHARD_TARGETS)),
  );
  const parallelWallMs = performance.now() - parallelWallStart;
  const parallelCpu = cpuOf(parallelCpuStart, parallelWallMs);
  const parallelApplied = shards.reduce((sum, shard) => sum + shard.expireApply.applied, 0);
  const sequentialApplied = sequential.reduce(
    (sum, item) => sum + item.expireApply.applied,
    0,
  );

  console.log(
    JSON.stringify(
      {
        hostCores: cpus().length,
        shards: SHARD_COUNT,
        perShard: SHARD_TARGETS,
        sequential: {
          wallMs: roundMs(sequentialWallMs),
          cpu: sequentialCpu,
          applied: sequentialApplied,
          appliedPerSec:
            sequentialWallMs <= 0
              ? sequentialApplied
              : Math.round(sequentialApplied / (sequentialWallMs / 1000)),
        },
        parallel: {
          wallMs: roundMs(parallelWallMs),
          cpu: parallelCpu,
          applied: parallelApplied,
          appliedPerSec:
            parallelWallMs <= 0
              ? parallelApplied
              : Math.round(parallelApplied / (parallelWallMs / 1000)),
          shardWallMs: shards.map((shard) => shard.expireApply.wallMs),
        },
        speedup:
          parallelWallMs <= 0 ? 0 : roundMs(sequentialWallMs / parallelWallMs),
      },
      null,
      2,
    ),
  );
}

function runShard(): void {
  const raw = process.argv.find((arg) => arg.startsWith("--count="));
  const count = Number(raw?.slice("--count=".length));
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("shard requires --count=N");
  }
  const pipeline = setup(count, 0);
  pipeline.clock.flush();
  const expireApply = phaseOf(
    timed(() => {
      pipeline.idle.setIdleTimeSeconds(1);
      pipeline.idle.emitPower();
    }),
  );
  const result: ShardResult = {
    targets: count,
    expireApply: {
      ...expireApply,
      applied: pipeline.port.applied,
    },
  };
  disposePipeline(pipeline);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--shard")) {
    runShard();
    return;
  }

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
        note: "Electron main + core + manager share one JS thread. Occupancy is that one core. Multi-process shards measure isolated pipelines.",
      },
      null,
      2,
    ),
  );

  for (const count of TARGET_SCALES) {
    const keepGoing = await runScale(count);
    if (!keepGoing) {
      console.log(`limit reached at ${count.toLocaleString("en-US")} targets`);
      break;
    }
  }

  await runConcurrencySweep();
  await runAsyncCompare();
  await runParallelShards();
}

await main();
