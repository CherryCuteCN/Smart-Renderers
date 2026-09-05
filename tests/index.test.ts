import { expect, test } from "vitest";
import * as smartRenderers from "../src/index";
import { attachContents, createSmartRenderers } from "../src/index";
import type {
  BrowserWindowLike,
  Clock,
  IdleSource,
  WebContentsLike,
} from "../src/index";

test("re-exports the core and manager contracts", () => {
  expect(smartRenderers.createRuntime).toBeTypeOf("function");
  expect(smartRenderers.createManager).toBeTypeOf("function");
  expect(smartRenderers.createSmartRenderers).toBeTypeOf("function");
  expect(smartRenderers.attachContents).toBeTypeOf("function");
  expect(smartRenderers.detectAvailability).toBeTypeOf("function");
  expect(smartRenderers.createMemoryActionPort).toBeTypeOf("function");
  expect(smartRenderers.createHandleRegistry).toBeTypeOf("function");
  expect(smartRenderers.isBindableActionPort).toBeTypeOf("function");
  expect(smartRenderers.tryCreateElectronIdleSource).toBeTypeOf("function");
  expect(smartRenderers.tryCreateElectronActionPort).toBeTypeOf("function");
  expect(smartRenderers.SNAPSHOT_SCHEMA).toBe("smart-renderers/snapshot/1");
  expect(smartRenderers.DEFAULT_COUNTDOWN_MS).toBe(15 * 60 * 1000);
  expect(smartRenderers.DEFAULT_EXPIRED_ACTION).toBe("hibernate");
});

test("createSmartRenderers tracks, expires, and reverts through one facade", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const calls: string[] = [];
  const events: string[] = [];
  const api = createSmartRenderers({
    clock,
    idle,
    countdownMs: 1_000,
    host: {
      getAvailability: () => ({
        electron: true,
        processType: "browser",
        rendererCapable: true,
      }),
    },
  });
  api.subscribe((event) => {
    events.push(event.type);
  });

  api.track(
    { id: "win-1", pid: 11 },
    {
      hibernate() {
        calls.push("hibernate");
      },
      restore() {
        calls.push("restore");
      },
    },
  );
  clock.flush();
  idle.setIdleTimeSeconds(1);
  idle.emitPower();

  expect(calls).toEqual(["hibernate"]);
  expect(api.getApplied()[0]?.action).toBe("hibernate");
  expect(events).toContain("countdown.expired");
  expect(events).toContain("action.applied");

  api.reportActivity("win-1");
  expect(calls).toEqual(["hibernate", "restore"]);
  expect(api.getApplied()).toEqual([]);

  api.dispose();
  expect(() => api.getSnapshot()).toThrowError(/disposed/);
});

test("attachContents binds an electron-like webContents and can detach", () => {
  const clock = createFakeClock();
  const api = createSmartRenderers({
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
  const contents: WebContentsLike & { id: number; throttling: boolean } = {
    id: 7,
    throttling: false,
    setBackgroundThrottling(value) {
      contents.throttling = value;
    },
  };

  const detach = attachContents(api, contents);
  expect(api.getSnapshot().targets.map((target) => target.id)).toEqual(["7"]);

  detach();
  expect(api.getSnapshot().targets).toEqual([]);
  api.dispose();
});

test("a single idle window expires and is closed", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const events: Array<{ type: string; targetId?: string; action?: string }> = [];
  const api = createSmartRenderers({
    clock,
    idle,
    countdownMs: 1_000,
    idleAfterMs: 0,
    host: capableHost(),
    policy: {
      onExpired: "destroy",
      untrackOnDestroy: true,
    },
  });
  api.subscribe((event) => {
    events.push({
      type: event.type,
      targetId: event.targetId,
      action: "action" in event ? event.action : undefined,
    });
  });

  const contents = fakeContents(3);
  const window = fakeWindow();
  attachContents(api, contents, window);

  clock.flush();
  expect(api.getSnapshot().targets[0]?.countdown.phase).toBe("running");
  expect(window.destroyed).toBe(false);

  idle.setIdleTimeSeconds(1);
  idle.emitPower();

  expect(window.destroyed).toBe(true);
  expect(contents.closed).toBe(false);
  expect(events).toContainEqual({
    type: "countdown.expired",
    targetId: "3",
    action: undefined,
  });
  expect(events).toContainEqual({
    type: "action.applied",
    targetId: "3",
    action: "destroy",
  });
  expect(api.getSnapshot().targets).toEqual([]);
  api.dispose();
});

test("pages that share one renderer pid stay distinct targets", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const applied: string[] = [];
  const api = createSmartRenderers({
    clock,
    idle,
    countdownMs: 1_000,
    idleAfterMs: 0,
    host: capableHost(),
    policy: {
      onExpired: "destroy",
      untrackOnDestroy: true,
    },
  });
  api.subscribe((event) => {
    if (event.type === "action.applied") {
      applied.push(`${event.action}:${event.targetId}`);
    }
  });

  const pageA = fakeContents(10);
  const pageB = fakeContents(11);
  const windowA = fakeWindow();
  const windowB = fakeWindow();
  attachContents(api, pageA, windowA);
  attachContents(api, pageB, windowB);

  const before = api.getSnapshot();
  expect(before.targets.map((target) => target.id)).toEqual(["10", "11"]);
  expect(before.targets[0]?.pid).toBe(process.pid);
  expect(before.targets[1]?.pid).toBe(process.pid);
  expect(before.targets[0]?.pid).toBe(before.targets[1]?.pid);

  clock.flush();
  api.reportActivity("11");
  idle.setIdleTimeSeconds(1);
  idle.emitPower();

  expect(applied).toEqual(["destroy:10"]);
  expect(windowA.destroyed).toBe(true);
  expect(windowB.destroyed).toBe(false);
  expect(api.getSnapshot().targets.map((target) => target.id)).toEqual(["11"]);
  expect(api.getSnapshot().targets[0]?.countdown.phase).toBe("inactive");
  api.dispose();
});

test("ending one shared-renderer page does not close the page still in use", () => {
  const clock = createFakeClock();
  const idle = createFakeIdleSource();
  const applied: string[] = [];
  const cancelled: string[] = [];
  const api = createSmartRenderers({
    clock,
    idle,
    countdownMs: 1_000,
    idleAfterMs: 0,
    host: capableHost(),
    policy: {
      onExpired: "destroy",
      untrackOnDestroy: true,
    },
  });
  api.subscribe((event) => {
    if (event.type === "action.applied") {
      applied.push(`${event.action}:${event.targetId}`);
    }
    if (event.type === "countdown.cancelled") {
      cancelled.push(`${event.reason}:${event.targetId}`);
    }
  });

  const pageA = fakeContents(10);
  const pageB = fakeContents(11);
  const windowA = fakeWindow();
  const windowB = fakeWindow();
  const detachA = attachContents(api, pageA, windowA);
  attachContents(api, pageB, windowB);
  clock.flush();

  api.reportActivity("11");
  detachA();
  idle.setIdleTimeSeconds(1);
  idle.emitPower();

  expect(cancelled).toContain("untracked:10");
  expect(cancelled).not.toContain("untracked:11");
  expect(applied).toEqual([]);
  expect(windowA.destroyed).toBe(false);
  expect(windowB.destroyed).toBe(false);
  expect(api.getSnapshot().targets.map((target) => target.id)).toEqual(["11"]);

  clock.flush();
  idle.emitPower();

  expect(applied).toEqual(["destroy:11"]);
  expect(windowB.destroyed).toBe(true);
  expect(windowA.destroyed).toBe(false);
  api.dispose();
});

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

function capableHost() {
  return {
    getAvailability: () => ({
      electron: true,
      processType: "browser" as const,
      rendererCapable: true,
    }),
  };
}

function fakeContents(id: number): WebContentsLike & {
  id: number;
  destroyed: boolean;
  closed: boolean;
} {
  return {
    id,
    destroyed: false,
    closed: false,
    isDestroyed() {
      return this.destroyed;
    },
    close() {
      this.closed = true;
      this.destroyed = true;
    },
  };
}

function fakeWindow(): BrowserWindowLike & { destroyed: boolean } {
  return {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    destroy() {
      this.destroyed = true;
    },
  };
}
