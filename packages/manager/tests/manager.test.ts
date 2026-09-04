import { expect, test } from "vitest";
import { createManager } from "../src/index";
import type { Operator } from "../src/index";
import type {
  CoreEvent,
  RendererSnapshot,
  Runtime,
} from "@smart-renderers/core";

function snapshot(observedAt = 0): RendererSnapshot {
  return {
    schema: "smart-renderers/snapshot/1",
    observedAt,
    availability: {
      electron: true,
      processType: "browser",
      rendererCapable: true,
    },
    targets: [],
    aggregate: {
      targetCount: 0,
      idleCount: 0,
      allIdle: false,
    },
  };
}

function expiredEvent(targetId = "win-1"): CoreEvent {
  return {
    type: "countdown.expired",
    targetId,
    snapshot: snapshot(),
  };
}

function createFakeRuntime(
  current: RendererSnapshot = snapshot(),
): Runtime & { emit: (event: CoreEvent) => void } {
  const listeners = new Set<(event: CoreEvent) => void>();
  return {
    track() {
      return;
    },
    untrack() {
      return;
    },
    reportActivity() {
      return;
    },
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
    },
    emit(event) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
  };
}

function collectOperator(
  name: string,
  interestedIn: Operator["interestedIn"] = ["countdown.expired"],
): Operator & { events: CoreEvent[] } {
  const events: CoreEvent[] = [];
  return {
    name,
    interestedIn,
    events,
    handle(event) {
      events.push(event);
    },
  };
}

test("dispatches matching events to operators", () => {
  const runtime = createFakeRuntime();
  const hibernate = collectOperator("hibernate");
  const manager = createManager({ runtime, operators: [hibernate] });

  const event = expiredEvent();
  runtime.emit(event);

  expect(hibernate.events).toEqual([event]);
  manager.dispose();
});

test("skips operators that are not interested", () => {
  const runtime = createFakeRuntime();
  const started = collectOperator("started", ["countdown.started"]);
  const manager = createManager({ runtime, operators: [started] });

  runtime.emit(expiredEvent());

  expect(started.events).toEqual([]);
  manager.dispose();
});

test("getSnapshot delegates to runtime", () => {
  const current = snapshot(42);
  const runtime = createFakeRuntime(current);
  const manager = createManager({ runtime });

  expect(manager.getSnapshot()).toBe(current);
  manager.dispose();
});

test("register rejects duplicate operator names", () => {
  const runtime = createFakeRuntime();
  const manager = createManager({
    runtime,
    operators: [collectOperator("hibernate")],
  });

  expect(() => manager.register(collectOperator("hibernate"))).toThrowError(
    /already registered/,
  );
  manager.dispose();
});

test("isolates operator errors", () => {
  const runtime = createFakeRuntime();
  const failures: string[] = [];
  const broken: Operator = {
    name: "broken",
    interestedIn: ["countdown.expired"],
    handle() {
      throw new Error("boom");
    },
  };
  const ok = collectOperator("ok");
  const manager = createManager({
    runtime,
    operators: [broken, ok],
    onOperatorError(_error, operator) {
      failures.push(operator.name);
    },
  });

  runtime.emit(expiredEvent());

  expect(failures).toEqual(["broken"]);
  expect(ok.events).toHaveLength(1);
  manager.dispose();
});

test("dispose unsubscribes and rejects later use", () => {
  const runtime = createFakeRuntime();
  const hibernate = collectOperator("hibernate");
  const manager = createManager({ runtime, operators: [hibernate] });

  manager.dispose();
  runtime.emit(expiredEvent());

  expect(hibernate.events).toEqual([]);
  expect(() => manager.getSnapshot()).toThrowError(/disposed/);
});
