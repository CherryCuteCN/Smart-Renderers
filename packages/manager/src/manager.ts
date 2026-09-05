import type { CoreEvent, RendererSnapshot, TrackedTarget } from "@smart-renderers/core";
import { tryCreateElectronActionPort } from "./electron-actions";
import { createMemoryActionPort, isBindableActionPort } from "./memory-actions";
import { DEFAULT_EXPIRED_ACTION } from "./types";
import type {
  AppliedAction,
  ExpiredAction,
  Manager,
  ManagerEvent,
  ManagerOptions,
  Operator,
  RendererAction,
} from "./types";

const REVERSIBLE: Record<RendererAction, boolean> = {
  throttle: true,
  hibernate: true,
  destroy: false,
};

export function createManager(options: ManagerOptions): Manager {
  const operators = new Map<string, Operator>();
  const applied = new Map<string, AppliedAction>();
  const inFlight = new Set<string>();
  const revertAfter = new Set<string>();
  const listeners = new Set<(event: ManagerEvent) => void>();
  const actions =
    options.actions ??
    tryCreateElectronActionPort() ??
    createMemoryActionPort();
  const revertOnActivity = options.policy?.revertOnActivity ?? true;
  const untrackOnDestroy = options.policy?.untrackOnDestroy ?? true;
  let disposed = false;

  for (const operator of options.operators ?? []) {
    addOperator(operators, operator);
  }

  const unsubscribe = options.runtime.subscribe((event) => {
    if (disposed) {
      return;
    }
    handleCoreEvent(event);
    dispatchOperators(event);
  });

  function handleCoreEvent(event: CoreEvent): void {
    if (event.type === "countdown.expired") {
      executeExpired(event.targetId, event.snapshot);
      return;
    }
    if (event.type === "countdown.cancelled") {
      executeCancelled(event.targetId, event.reason, event.snapshot);
    }
  }

  function executeExpired(targetId: string, snapshot: RendererSnapshot): void {
    if (
      applied.has(targetId) ||
      inFlight.has(targetId) ||
      !snapshot.availability.rendererCapable
    ) {
      return;
    }
    const target = findTarget(snapshot, targetId);
    if (!target) {
      return;
    }
    let action: RendererAction;
    try {
      action = resolveExpiredAction(options.policy?.onExpired, target, snapshot);
    } catch (error) {
      emit({
        type: "action.failed",
        action: DEFAULT_EXPIRED_ACTION,
        targetId,
        error,
        snapshot,
      });
      return;
    }
    inFlight.add(targetId);
    settle(
      () => actions.apply(action, target, snapshot),
      () => {
        inFlight.delete(targetId);
        if (disposed) {
          return;
        }
        applied.set(targetId, {
          targetId,
          action,
          appliedAt: snapshot.observedAt,
        });
        emit({
          type: "action.applied",
          action,
          targetId,
          snapshot,
        });
        if (revertAfter.delete(targetId)) {
          if (REVERSIBLE[action] && revertOnActivity) {
            executeRevert(targetId, snapshot);
          }
          return;
        }
        if (action === "destroy" && untrackOnDestroy) {
          options.runtime.untrack(targetId);
        }
      },
      (error) => {
        inFlight.delete(targetId);
        revertAfter.delete(targetId);
        if (disposed) {
          return;
        }
        emit({
          type: "action.failed",
          action,
          targetId,
          error,
          snapshot,
        });
      },
    );
  }

  function executeCancelled(
    targetId: string,
    reason: "activity" | "untracked",
    snapshot: RendererSnapshot,
  ): void {
    if (reason === "untracked") {
      revertAfter.delete(targetId);
      applied.delete(targetId);
      if (isBindableActionPort(actions)) {
        actions.unbind(targetId);
      }
      return;
    }
    if (!revertOnActivity) {
      return;
    }
    if (inFlight.has(targetId)) {
      revertAfter.add(targetId);
      return;
    }
    const current = applied.get(targetId);
    if (!current || !REVERSIBLE[current.action]) {
      return;
    }
    executeRevert(targetId, snapshot);
  }

  function executeRevert(targetId: string, snapshot: RendererSnapshot): void {
    const current = applied.get(targetId);
    if (!current) {
      return;
    }
    const target = findTarget(snapshot, targetId) ?? syntheticTarget(current, snapshot);
    inFlight.add(targetId);
    settle(
      () => actions.revert(target, snapshot),
      () => {
        inFlight.delete(targetId);
        if (disposed) {
          return;
        }
        applied.delete(targetId);
        emit({
          type: "action.reverted",
          targetId,
          snapshot,
        });
      },
      (error) => {
        inFlight.delete(targetId);
        if (disposed) {
          return;
        }
        emit({
          type: "action.failed",
          action: "revert",
          targetId,
          error,
          snapshot,
        });
      },
    );
  }

  function dispatchOperators(event: CoreEvent): void {
    for (const operator of [...operators.values()]) {
      if (!operator.interestedIn.includes(event.type)) {
        continue;
      }
      try {
        void Promise.resolve(operator.handle(event)).catch((error: unknown) => {
          options.onOperatorError?.(error, operator, event);
        });
      } catch (error) {
        options.onOperatorError?.(error, operator, event);
      }
    }
  }

  function emit(event: ManagerEvent): void {
    for (const listener of [...listeners]) {
      listener(event);
    }
  }

  function assertOpen(): void {
    if (disposed) {
      throw new Error("manager is disposed");
    }
  }

  return {
    register(operator) {
      assertOpen();
      addOperator(operators, operator);
    },
    unregister(name) {
      assertOpen();
      operators.delete(name);
    },
    bind(id, handle) {
      assertOpen();
      if (!isBindableActionPort(actions)) {
        throw new Error("action port does not support bind");
      }
      actions.bind(id, handle);
    },
    unbind(id) {
      assertOpen();
      if (!isBindableActionPort(actions)) {
        throw new Error("action port does not support bind");
      }
      actions.unbind(id);
    },
    getSnapshot() {
      assertOpen();
      return options.runtime.getSnapshot();
    },
    getApplied() {
      assertOpen();
      return [...applied.values()];
    },
    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe();
      operators.clear();
      applied.clear();
      inFlight.clear();
      revertAfter.clear();
      listeners.clear();
    },
  };
}

function addOperator(
  operators: Map<string, Operator>,
  operator: Operator,
): void {
  if (operators.has(operator.name)) {
    throw new Error(`operator already registered: ${operator.name}`);
  }
  operators.set(operator.name, operator);
}

function findTarget(
  snapshot: RendererSnapshot,
  id: string,
): TrackedTarget | undefined {
  return snapshot.targets.find((target) => target.id === id);
}

function resolveExpiredAction(
  spec: ExpiredAction | undefined,
  target: TrackedTarget,
  snapshot: RendererSnapshot,
): RendererAction {
  const resolved =
    typeof spec === "function"
      ? spec(target, snapshot)
      : (spec ?? DEFAULT_EXPIRED_ACTION);
  if (!isRendererAction(resolved)) {
    throw new Error(`unsupported action: ${String(resolved)}`);
  }
  return resolved;
}

function isRendererAction(value: string): value is RendererAction {
  return value === "throttle" || value === "hibernate" || value === "destroy";
}

function syntheticTarget(
  current: AppliedAction,
  snapshot: RendererSnapshot,
): TrackedTarget {
  return {
    id: current.targetId,
    pid: 0,
    kind: "window",
    lastActivityAt: snapshot.observedAt,
    idle: false,
    countdown: {
      phase: "inactive",
      durationMs: 0,
    },
  };
}

function settle(
  work: () => void | Promise<void>,
  onSuccess: () => void,
  onError: (error: unknown) => void,
): void {
  try {
    const result = work();
    if (typeof result === "object" && result !== null) {
      void result.then(onSuccess, onError);
      return;
    }
    onSuccess();
  } catch (error) {
    onError(error);
  }
}
