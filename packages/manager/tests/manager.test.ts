import { expect, test } from "vitest";
import { createManager } from "../src/index";
import type {
  ActionPort,
  ManagerEvent,
  Operator,
  RendererAction,
} from "../src/index";
import type {
  CoreEvent,
  RendererSnapshot,
  Runtime,
  TrackedTarget,
} from "@smart-renderers/core";

function snapshot(overrides: Partial<RendererSnapshot> = {}): RendererSnapshot {
  return {
    schema: "smart-renderers/snapshot/1",
    observedAt: 0,
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
    ...overrides,
  };
}

function tracked(
  id = "win-1",
  kind: TrackedTarget["kind"] = "window",
): TrackedTarget {
  return {
    id,
    pid: 11,
    kind,
    lastActivityAt: 0,
    idle: true,
    countdown: {
      phase: "expired",
      durationMs: 1000,
      remainingMs: 0,
    },
  };
}

function snapshotWithTarget(
  id = "win-1",
  kind: TrackedTarget["kind"] = "window",
): RendererSnapshot {
  const target = tracked(id, kind);
  return snapshot({
    targets: [target],
    aggregate: { targetCount: 1, idleCount: 1, allIdle: true },
  });
}

function expiredEvent(
  current = snapshotWithTarget(),
  targetId = "win-1",
): CoreEvent {
  return {
    type: "countdown.expired",
    targetId,
    snapshot: current,
  };
}

function cancelledEvent(
  reason: "activity" | "untracked",
  current = snapshotWithTarget(),
  targetId = "win-1",
): CoreEvent {
  return {
    type: "countdown.cancelled",
    targetId,
    reason,
    snapshot: current,
  };
}

function createFakeRuntime(
  current: RendererSnapshot = snapshot(),
): Runtime & {
  emit: (event: CoreEvent) => void;
  untracked: string[];
} {
  const listeners = new Set<(event: CoreEvent) => void>();
  const untracked: string[] = [];
  const runtime: Runtime & {
    emit: (event: CoreEvent) => void;
    untracked: string[];
  } = {
    untracked,
    track() {
      return;
    },
    untrack(id) {
      untracked.push(id);
      runtime.emit({
        type: "countdown.cancelled",
        targetId: id,
        reason: "untracked",
        snapshot: snapshot(),
      });
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
  return runtime;
}

function createFakeActions(): ActionPort & {
  applied: Array<{ action: RendererAction; id: string }>;
  reverted: string[];
} {
  const applied: Array<{ action: RendererAction; id: string }> = [];
  const reverted: string[] = [];
  return {
    applied,
    reverted,
    apply(action, target) {
      applied.push({ action, id: target.id });
    },
    revert(target) {
      reverted.push(target.id);
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

  const event = expiredEvent(snapshot());
  runtime.emit(event);

  expect(hibernate.events).toEqual([event]);
  manager.dispose();
});

test("skips operators that are not interested", () => {
  const runtime = createFakeRuntime();
  const started = collectOperator("started", ["countdown.started"]);
  const manager = createManager({ runtime, operators: [started] });

  runtime.emit(expiredEvent(snapshot()));

  expect(started.events).toEqual([]);
  manager.dispose();
});

test("getSnapshot delegates to runtime", () => {
  const current = snapshot({ observedAt: 42 });
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

  runtime.emit(expiredEvent(snapshot()));

  expect(failures).toEqual(["broken"]);
  expect(ok.events).toHaveLength(1);
  manager.dispose();
});

test("dispose unsubscribes and rejects later use", () => {
  const runtime = createFakeRuntime();
  const hibernate = collectOperator("hibernate");
  const manager = createManager({ runtime, operators: [hibernate] });

  manager.dispose();
  runtime.emit(expiredEvent(snapshot()));

  expect(hibernate.events).toEqual([]);
  expect(() => manager.getSnapshot()).toThrowError(/disposed/);
});

test("applies hibernate when countdown expires", () => {
  const runtime = createFakeRuntime();
  const actions = createFakeActions();
  const events: ManagerEvent[] = [];
  const manager = createManager({ runtime, actions });
  manager.subscribe((event) => events.push(event));

  runtime.emit(expiredEvent());

  expect(actions.applied).toEqual([{ action: "hibernate", id: "win-1" }]);
  expect(manager.getApplied()).toEqual([
    { targetId: "win-1", action: "hibernate", appliedAt: 0 },
  ]);
  expect(events.map((event) => event.type)).toEqual(["action.applied"]);
  manager.dispose();
});

test("does not apply the same target twice", () => {
  const runtime = createFakeRuntime();
  const actions = createFakeActions();
  const manager = createManager({ runtime, actions });

  runtime.emit(expiredEvent());
  runtime.emit(expiredEvent());

  expect(actions.applied).toHaveLength(1);
  manager.dispose();
});

test("reverts on activity after hibernate", () => {
  const runtime = createFakeRuntime();
  const actions = createFakeActions();
  const events: ManagerEvent[] = [];
  const manager = createManager({ runtime, actions });
  manager.subscribe((event) => events.push(event));

  runtime.emit(expiredEvent());
  runtime.emit(cancelledEvent("activity"));

  expect(actions.reverted).toEqual(["win-1"]);
  expect(manager.getApplied()).toEqual([]);
  expect(events.map((event) => event.type)).toEqual([
    "action.applied",
    "action.reverted",
  ]);
  manager.dispose();
});

test("does not revert when the target is untracked", () => {
  const runtime = createFakeRuntime();
  const actions = createFakeActions();
  const manager = createManager({ runtime, actions });

  runtime.emit(expiredEvent());
  runtime.emit(cancelledEvent("untracked"));

  expect(actions.reverted).toEqual([]);
  expect(manager.getApplied()).toEqual([]);
  manager.dispose();
});

test("destroy does not revert and untracks the target", () => {
  const runtime = createFakeRuntime();
  const actions = createFakeActions();
  const manager = createManager({
    runtime,
    actions,
    policy: { onExpired: "destroy" },
  });

  runtime.emit(expiredEvent());
  runtime.emit(cancelledEvent("activity"));

  expect(actions.applied).toEqual([{ action: "destroy", id: "win-1" }]);
  expect(runtime.untracked).toEqual(["win-1"]);
  expect(actions.reverted).toEqual([]);
  expect(manager.getApplied()).toEqual([]);
  manager.dispose();
});

test("policy function selects the action", () => {
  const runtime = createFakeRuntime();
  const actions = createFakeActions();
  const manager = createManager({
    runtime,
    actions,
    policy: {
      onExpired: (target) => (target.kind === "window" ? "throttle" : "hibernate"),
    },
  });

  runtime.emit(expiredEvent());

  expect(actions.applied).toEqual([{ action: "throttle", id: "win-1" }]);
  manager.dispose();
});

test("skips execution when the process cannot manage renderers", () => {
  const runtime = createFakeRuntime();
  const actions = createFakeActions();
  const manager = createManager({ runtime, actions });

  runtime.emit(
    expiredEvent(
      snapshot({
        availability: {
          electron: false,
          processType: "unknown",
          rendererCapable: false,
        },
        targets: [tracked()],
      }),
    ),
  );

  expect(actions.applied).toEqual([]);
  manager.dispose();
});

test("records action failures without blocking operators", () => {
  const runtime = createFakeRuntime();
  const ok = collectOperator("ok");
  const events: ManagerEvent[] = [];
  const manager = createManager({
    runtime,
    operators: [ok],
    actions: {
      apply() {
        throw new Error("apply failed");
      },
      revert() {
        return;
      },
    },
  });
  manager.subscribe((event) => events.push(event));

  runtime.emit(expiredEvent());

  expect(events).toEqual([
    expect.objectContaining({
      type: "action.failed",
      action: "hibernate",
      targetId: "win-1",
    }),
  ]);
  expect(ok.events).toHaveLength(1);
  expect(manager.getApplied()).toEqual([]);
  manager.dispose();
});

test("bind uses the memory action port", () => {
  const runtime = createFakeRuntime();
  const calls: string[] = [];
  const manager = createManager({ runtime });
  manager.bind("win-1", {
    hibernate() {
      calls.push("hibernate");
    },
  });

  runtime.emit(expiredEvent());

  expect(calls).toEqual(["hibernate"]);
  expect(manager.getApplied()[0]?.action).toBe("hibernate");
  manager.dispose();
});
