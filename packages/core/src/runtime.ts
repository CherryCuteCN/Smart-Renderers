import { tryCreateElectronIdleSource } from "./electron-idle";
import {
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_IDLE_AFTER_MS,
  SNAPSHOT_SCHEMA,
} from "./types";
import type {
  Availability,
  Clock,
  CoreEvent,
  IdleSource,
  ProcessType,
  RendererSnapshot,
  Runtime,
  RuntimeOptions,
  TargetKind,
  TrackedTarget,
  TrackInput,
} from "./types";

type Phase = "active" | "countdown" | "expired";

type InternalTarget = {
  id: string;
  pid: number;
  kind: TargetKind;
  lastActivityAt: number;
  phase: Phase;
  countdownStartedAt?: number;
  cancelTimer?: () => void;
};

const NEVER_IDLE: IdleSource = {
  getIdleTimeSeconds: () => 0,
  getIdleState: () => "active",
  subscribe: () => () => undefined,
};

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

export function detectAvailability(
  proc: NodeJS.Process = process,
): Availability {
  const electron = hasElectron(proc.versions);
  const processType = readProcessType(proc);
  return {
    electron,
    processType,
    rendererCapable: electron && processType === "browser",
  };
}

export function createRuntime(options: RuntimeOptions = {}): Runtime {
  const countdownMs = options.countdownMs ?? DEFAULT_COUNTDOWN_MS;
  const idleAfterMs = options.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
  if (countdownMs < 0 || idleAfterMs < 0) {
    throw new Error("countdownMs and idleAfterMs must be >= 0");
  }

  const clock = options.clock ?? systemClock;
  const idle = options.idle ?? tryCreateElectronIdleSource() ?? NEVER_IDLE;
  const host = options.host;
  const thresholdSeconds = Math.max(1, Math.ceil(countdownMs / 1000));

  const targets = new Map<string, InternalTarget>();
  const listeners = new Set<(event: CoreEvent) => void>();
  let disposed = false;
  let stopPowerWatch: (() => void) | undefined;

  function availability(): Availability {
    return host?.getAvailability() ?? detectAvailability();
  }

  function remainingMs(): number {
    return Math.max(
      0,
      (thresholdSeconds - idle.getIdleTimeSeconds()) * 1000,
    );
  }

  function snapshot(): RendererSnapshot {
    const observedAt = clock.now();
    const listed: TrackedTarget[] = [];
    for (const target of targets.values()) {
      listed.push(toTrackedTarget(target, observedAt, countdownMs, remainingMs()));
    }
    const idleCount = listed.filter((target) => target.idle).length;
    return {
      schema: SNAPSHOT_SCHEMA,
      observedAt,
      availability: availability(),
      targets: listed,
      aggregate: {
        targetCount: listed.length,
        idleCount,
        allIdle: listed.length > 0 && idleCount === listed.length,
      },
    };
  }

  function emit(event: CoreEvent): void {
    for (const listener of [...listeners]) {
      listener(event);
    }
  }

  function clearTimer(target: InternalTarget): void {
    target.cancelTimer?.();
    target.cancelTimer = undefined;
  }

  function schedule(target: InternalTarget, delay: number, fn: () => void): void {
    clearTimer(target);
    target.cancelTimer = clock.setTimeout(() => {
      target.cancelTimer = undefined;
      fn();
    }, delay);
  }

  function ensurePowerWatch(): void {
    if (stopPowerWatch || disposed) {
      return;
    }
    stopPowerWatch = idle.subscribe(() => {
      for (const target of [...targets.values()]) {
        if (target.phase === "countdown") {
          evaluateIdle(target);
        }
      }
    });
  }

  function becomeActive(target: InternalTarget): void {
    target.phase = "active";
    target.lastActivityAt = clock.now();
    target.countdownStartedAt = undefined;
    schedule(target, idleAfterMs, () => {
      startCountdown(target);
    });
  }

  function startCountdown(target: InternalTarget): void {
    if (disposed || target.phase !== "active" || !targets.has(target.id)) {
      return;
    }
    target.phase = "countdown";
    target.countdownStartedAt = clock.now();
    emit({
      type: "countdown.started",
      targetId: target.id,
      snapshot: snapshot(),
    });
    evaluateIdle(target);
  }

  function evaluateIdle(target: InternalTarget): void {
    if (disposed || target.phase !== "countdown" || !targets.has(target.id)) {
      return;
    }
    ensurePowerWatch();
    const state = idle.getIdleState(thresholdSeconds);
    if (state === "idle" || state === "locked") {
      expire(target);
      return;
    }
    const delay = remainingMs();
    schedule(target, delay > 0 ? delay : 1000, () => {
      evaluateIdle(target);
    });
  }

  function expire(target: InternalTarget): void {
    if (disposed || target.phase !== "countdown" || !targets.has(target.id)) {
      return;
    }
    clearTimer(target);
    target.phase = "expired";
    emit({
      type: "countdown.expired",
      targetId: target.id,
      snapshot: snapshot(),
    });
  }

  function assertOpen(): void {
    if (disposed) {
      throw new Error("runtime is disposed");
    }
  }

  return {
    track(input: TrackInput) {
      assertOpen();
      const existing = targets.get(input.id);
      if (existing) {
        const wasCounting = existing.phase === "countdown";
        existing.pid = input.pid;
        existing.kind = input.kind ?? existing.kind;
        becomeActive(existing);
        if (wasCounting) {
          emit({
            type: "countdown.cancelled",
            targetId: existing.id,
            reason: "activity",
            snapshot: snapshot(),
          });
        }
        return;
      }
      const target: InternalTarget = {
        id: input.id,
        pid: input.pid,
        kind: input.kind ?? "window",
        lastActivityAt: clock.now(),
        phase: "active",
      };
      targets.set(target.id, target);
      becomeActive(target);
    },
    untrack(id: string) {
      assertOpen();
      const target = targets.get(id);
      if (!target) {
        return;
      }
      const wasCounting = target.phase === "countdown";
      clearTimer(target);
      targets.delete(id);
      if (wasCounting) {
        emit({
          type: "countdown.cancelled",
          targetId: id,
          reason: "untracked",
          snapshot: snapshot(),
        });
      }
    },
    reportActivity(id: string) {
      assertOpen();
      const target = targets.get(id);
      if (!target) {
        return;
      }
      const wasCounting = target.phase === "countdown";
      becomeActive(target);
      if (wasCounting) {
        emit({
          type: "countdown.cancelled",
          targetId: id,
          reason: "activity",
          snapshot: snapshot(),
        });
      }
    },
    getSnapshot() {
      assertOpen();
      return snapshot();
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
      stopPowerWatch?.();
      stopPowerWatch = undefined;
      for (const target of targets.values()) {
        clearTimer(target);
      }
      targets.clear();
      listeners.clear();
    },
  };
}

function toTrackedTarget(
  target: InternalTarget,
  now: number,
  countdownMs: number,
  idleRemainingMs: number,
): TrackedTarget {
  const running = target.phase === "countdown";
  const expired = target.phase === "expired";
  return {
    id: target.id,
    pid: target.pid,
    kind: target.kind,
    lastActivityAt: target.lastActivityAt,
    idle: target.phase !== "active",
    countdown: {
      phase: running ? "running" : expired ? "expired" : "inactive",
      durationMs: countdownMs,
      startedAt: target.countdownStartedAt,
      expiresAt: running ? now + idleRemainingMs : undefined,
      remainingMs: running ? idleRemainingMs : expired ? 0 : undefined,
    },
  };
}

function hasElectron(versions: NodeJS.ProcessVersions): boolean {
  return typeof (versions as { electron?: unknown }).electron === "string";
}

function readProcessType(proc: NodeJS.Process): ProcessType {
  const type: unknown = (proc as { type?: unknown }).type;
  if (type === "browser" || type === "renderer" || type === "utility") {
    return type;
  }
  return "unknown";
}
