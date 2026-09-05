import { expect, test } from "vitest";
import {
  createRuntime,
  DEFAULT_COUNTDOWN_MS,
  detectAvailability,
  SNAPSHOT_SCHEMA,
} from "../src/index";
import type { Clock, CoreEvent, IdleSource, RendererSnapshot } from "../src/index";

function createFakeClock(start = 0): Clock & {
  advance: (ms: number) => void;
  flush: () => void;
} {
  let now = start;
  let seq = 0;
  const timers: Array<{
    id: number;
    at: number;
    fn: () => void;
    cancelled: boolean;
  }> = [];

  function flush(): void {
    for (;;) {
      const due = timers
        .filter((timer) => !timer.cancelled && timer.at <= now)
        .sort((a, b) => a.at - b.at || a.id - b.id);
      if (due.length === 0) {
        return;
      }
      for (const timer of due) {
        timer.cancelled = true;
      }
      for (const timer of due) {
        timer.fn();
      }
    }
  }

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const timer = {
        id: ++seq,
        at: now + ms,
        fn,
        cancelled: false,
      };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    advance(ms: number) {
      now += ms;
      flush();
    },
    flush,
  };
}

function createFakeIdleSource(initialSeconds = 0): IdleSource & {
  setIdleTimeSeconds: (seconds: number) => void;
  emitPower: () => void;
} {
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

function collectEvents(runtime: ReturnType<typeof createRuntime>): CoreEvent[] {
  const events: CoreEvent[] = [];
  runtime.subscribe((event) => {
    events.push(event);
  });
  return events;
}

test("detects no electron renderer in node tests", () => {
  const availability = detectAvailability();
  expect(availability.electron).toBe(false);
  expect(availability.processType).toBe("unknown");
  expect(availability.rendererCapable).toBe(false);
});

test("rejects negative timing options", () => {
  expect(() => createRuntime({ countdownMs: -1 })).toThrowError();
  expect(() => createRuntime({ idleAfterMs: -1 })).toThrowError();
});

test("snapshot lists tracked targets and injected availability", () => {
  const clock = createFakeClock();
  const runtime = createRuntime({
    clock,
    idle: createFakeIdleSource(),
    host: {
      getAvailability: () => ({
        electron: true,
        processType: "browser",
        rendererCapable: true,
      }),
    },
  });

  runtime.track({ id: "win-1", pid: 11, kind: "window" });
  runtime.track({ id: "view-2", pid: 22, kind: "webview" });

  const snapshot = runtime.getSnapshot();
  expect(snapshot.schema).toBe(SNAPSHOT_SCHEMA);
  expect(snapshot.availability.rendererCapable).toBe(true);
  expect(snapshot.aggregate).toEqual({
    targetCount: 2,
    idleCount: 0,
    allIdle: false,
  });
  expect(snapshot.targets.map((target) => target.id)).toEqual([
    "win-1",
    "view-2",
  ]);
  expect(snapshot.targets[0]).toMatchObject({
    pid: 11,
    kind: "window",
    idle: false,
    countdown: { phase: "inactive", durationMs: DEFAULT_COUNTDOWN_MS },
  });
});

test("idle after the grace period starts a per-target countdown", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const runtime = createRuntime({ clock, idle, idleAfterMs: 1_000 });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();
  expect(events).toEqual([]);
  expect(idleOf(runtime.getSnapshot(), "win-1")).toBe(false);

  clock.advance(1_000);
  expect(events.map((event) => event.type)).toEqual(["countdown.started"]);
  expect(events[0]).toMatchObject({ targetId: "win-1" });

  const snapshot = runtime.getSnapshot();
  expect(idleOf(snapshot, "win-1")).toBe(true);
  expect(countdownOf(snapshot, "win-1")).toMatchObject({
    phase: "running",
    startedAt: 1_000,
    expiresAt: 1_000 + DEFAULT_COUNTDOWN_MS,
    remainingMs: DEFAULT_COUNTDOWN_MS,
  });
  expect(snapshot.aggregate.allIdle).toBe(true);
});

test("default idleAfterMs starts countdown on the next timer turn", () => {
  const clock = createFakeClock();
  const runtime = createRuntime({ clock, idle: createFakeIdleSource() });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();

  expect(events.map((event) => event.type)).toEqual(["countdown.started"]);
});

test("chromium idle expires countdown once, activity can restart it", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const runtime = createRuntime({ clock, idle, countdownMs: 1_000 });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();
  runtime.reportActivity("win-1");
  expect(events.map((event) => event.type)).toEqual([
    "countdown.started",
    "countdown.cancelled",
  ]);
  expect(events[1]).toMatchObject({ reason: "activity" });
  expect(countdownOf(runtime.getSnapshot(), "win-1").phase).toBe("inactive");

  clock.flush();
  idle.setIdleTimeSeconds(1);
  idle.emitPower();
  expect(events.map((event) => event.type)).toEqual([
    "countdown.started",
    "countdown.cancelled",
    "countdown.started",
    "countdown.expired",
  ]);
  expect(countdownOf(runtime.getSnapshot(), "win-1").phase).toBe("expired");

  idle.emitPower();
  expect(events.filter((event) => event.type === "countdown.expired")).toHaveLength(
    1,
  );
});

test("untrack cancels a running countdown", () => {
  const clock = createFakeClock();
  const runtime = createRuntime({ clock, idle: createFakeIdleSource() });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();
  runtime.untrack("win-1");

  expect(events.at(-1)).toMatchObject({
    type: "countdown.cancelled",
    targetId: "win-1",
    reason: "untracked",
  });
  expect(runtime.getSnapshot().targets).toEqual([]);
});

test("targets keep independent countdowns", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const runtime = createRuntime({
    clock,
    idle,
    idleAfterMs: 5_000,
    countdownMs: 1_000,
  });
  const events = collectEvents(runtime);

  runtime.track({ id: "a", pid: 1 });
  runtime.track({ id: "b", pid: 2 });
  clock.advance(5_000);
  runtime.reportActivity("b");
  idle.setIdleTimeSeconds(1);
  idle.emitPower();

  expect(
    events.filter(
      (event) => event.type === "countdown.expired" && event.targetId === "a",
    ),
  ).toHaveLength(1);
  expect(countdownOf(runtime.getSnapshot(), "a").phase).toBe("expired");
  expect(countdownOf(runtime.getSnapshot(), "b").phase).toBe("inactive");
});

test("re-track updates pid and counts as activity", () => {
  const clock = createFakeClock();
  const runtime = createRuntime({
    clock,
    idle: createFakeIdleSource(),
    countdownMs: 1_000,
  });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();
  runtime.track({ id: "win-1", pid: 99, kind: "offscreen" });

  const snapshot = runtime.getSnapshot();
  expect(snapshot.targets).toHaveLength(1);
  expect(snapshot.targets[0]).toMatchObject({
    id: "win-1",
    pid: 99,
    kind: "offscreen",
    idle: false,
  });
  expect(events.at(-1)).toMatchObject({
    type: "countdown.cancelled",
    reason: "activity",
  });
});

test("activity after expire cancels the expired countdown", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const runtime = createRuntime({ clock, idle, countdownMs: 1_000 });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();
  idle.setIdleTimeSeconds(1);
  idle.emitPower();
  runtime.reportActivity("win-1");

  expect(events.map((event) => event.type)).toEqual([
    "countdown.started",
    "countdown.expired",
    "countdown.cancelled",
  ]);
  expect(events.at(-1)).toMatchObject({ reason: "activity" });
  expect(countdownOf(runtime.getSnapshot(), "win-1").phase).toBe("inactive");
});

test("untrack after expire still emits cancelled", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const runtime = createRuntime({ clock, idle, countdownMs: 1_000 });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();
  idle.setIdleTimeSeconds(1);
  idle.emitPower();
  runtime.untrack("win-1");

  expect(events.at(-1)).toMatchObject({
    type: "countdown.cancelled",
    reason: "untracked",
  });
});

test("dispose stops timers and rejects later use", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const runtime = createRuntime({ clock, idle, countdownMs: 1_000 });
  const events = collectEvents(runtime);

  runtime.track({ id: "win-1", pid: 11 });
  clock.flush();
  runtime.dispose();
  idle.setIdleTimeSeconds(1);
  idle.emitPower();
  clock.advance(1_000);

  expect(events.map((event) => event.type)).toEqual(["countdown.started"]);
  expect(() => runtime.getSnapshot()).toThrowError(/disposed/);
});

function idleOf(snapshot: RendererSnapshot, id: string): boolean {
  const target = snapshot.targets.find((item) => item.id === id);
  expect(target).toBeDefined();
  return target?.idle ?? false;
}

function countdownOf(snapshot: RendererSnapshot, id: string) {
  const target = snapshot.targets.find((item) => item.id === id);
  expect(target).toBeDefined();
  return target?.countdown ?? { phase: "inactive" as const, durationMs: 0 };
}
