import { expect, test } from "vitest";
import * as smartRenderers from "../src/index";
import { attachContents, createSmartRenderers } from "../src/index";
import type { Clock, IdleSource, WebContentsLike } from "../src/index";

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
