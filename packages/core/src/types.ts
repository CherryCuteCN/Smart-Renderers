export const SNAPSHOT_SCHEMA = "smart-renderers/snapshot/1" as const;
export const DEFAULT_COUNTDOWN_MS = 15 * 60 * 1000;
export const DEFAULT_IDLE_AFTER_MS = 0;

export type SnapshotSchema = typeof SNAPSHOT_SCHEMA;
export type ProcessType = "browser" | "renderer" | "utility" | "unknown";
export type TargetKind = "window" | "webview" | "offscreen" | "background";
export type CountdownPhase = "inactive" | "running" | "expired";
export type CountdownCancelReason = "activity" | "untracked";

export type Availability = {
  electron: boolean;
  processType: ProcessType;
  rendererCapable: boolean;
};

export type TargetCountdown = {
  phase: CountdownPhase;
  durationMs: number;
  startedAt?: number;
  remainingMs?: number;
  expiresAt?: number;
};

export type TrackedTarget = {
  id: string;
  pid: number;
  kind: TargetKind;
  lastActivityAt: number;
  idle: boolean;
  countdown: TargetCountdown;
};

export type RendererSnapshot = {
  schema: SnapshotSchema;
  observedAt: number;
  availability: Availability;
  targets: TrackedTarget[];
  aggregate: {
    targetCount: number;
    idleCount: number;
    allIdle: boolean;
  };
};

export type CoreEvent =
  | {
      type: "countdown.started";
      targetId: string;
      snapshot: RendererSnapshot;
    }
  | {
      type: "countdown.cancelled";
      targetId: string;
      reason: CountdownCancelReason;
      snapshot: RendererSnapshot;
    }
  | {
      type: "countdown.expired";
      targetId: string;
      snapshot: RendererSnapshot;
    };

export type TrackInput = {
  id: string;
  pid: number;
  kind?: TargetKind;
};

export type Clock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => () => void;
};

export type IdleState = "active" | "idle" | "locked" | "unknown";

export type IdleSource = {
  getIdleTimeSeconds: () => number;
  getIdleState: (thresholdSeconds: number) => IdleState;
  subscribe: (listener: () => void) => () => void;
};

export type PowerMonitorLike = {
  getSystemIdleTime: () => number;
  getSystemIdleState: (idleThreshold: number) => string;
  on: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  removeListener?: (event: string, listener: () => void) => void;
};

export type ElectronHost = {
  getAvailability: () => Availability;
};

export type RuntimeOptions = {
  countdownMs?: number;
  idleAfterMs?: number;
  clock?: Clock;
  idle?: IdleSource;
  host?: ElectronHost;
};

export type Runtime = {
  track: (input: TrackInput) => void;
  untrack: (id: string) => void;
  reportActivity: (id: string) => void;
  getSnapshot: () => RendererSnapshot;
  subscribe: (listener: (event: CoreEvent) => void) => () => void;
  dispose: () => void;
};
