import { expect, test } from "vitest";
import {
  createElectronIdleSource,
  tryCreateElectronIdleSource,
} from "../src/index";
import type { PowerMonitorLike } from "../src/index";

test("tryCreateElectronIdleSource is absent outside electron", () => {
  expect(tryCreateElectronIdleSource()).toBeUndefined();
});

test("createElectronIdleSource reads chromium idle from powerMonitor", () => {
  const listeners = new Map<string, Set<() => void>>();
  let idleTime = 12;
  const powerMonitor: PowerMonitorLike = {
    getSystemIdleTime: () => idleTime,
    getSystemIdleState: (threshold) => (idleTime >= threshold ? "idle" : "active"),
    on(event, listener) {
      const group = listeners.get(event) ?? new Set();
      group.add(listener);
      listeners.set(event, group);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
  };

  const idle = createElectronIdleSource(powerMonitor);
  expect(idle.getIdleTimeSeconds()).toBe(12);
  expect(idle.getIdleState(10)).toBe("idle");
  expect(idle.getIdleState(30)).toBe("active");

  const seen: string[] = [];
  const stop = idle.subscribe(() => {
    seen.push("power");
  });
  listeners.get("resume")?.forEach((listener) => {
    listener();
  });
  expect(seen).toEqual(["power"]);

  stop();
  idleTime = 40;
  listeners.get("resume")?.forEach((listener) => {
    listener();
  });
  expect(seen).toEqual(["power"]);
  expect(idle.getIdleState(30)).toBe("idle");
});
