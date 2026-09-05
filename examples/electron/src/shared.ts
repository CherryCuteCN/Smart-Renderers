import type {
  AppliedAction,
  RendererAction,
  RendererSnapshot,
  SmartRenderersEvent,
} from "smart-renderers";

export const IPC = {
  state: "demo:state",
  ready: "demo:ready",
  reportActivity: "demo:report-activity",
  openWindow: "demo:open-window",
  setDemoIdle: "demo:set-idle",
  setExpiredAction: "demo:set-expired-action",
} as const;

export const IDLE_AFTER_MS = 2_000;
export const COUNTDOWN_MS = 5_000;

export type DemoEvent = {
  at: number;
  type: SmartRenderersEvent["type"] | "demo.idle" | "demo.policy";
  targetId?: string;
  detail: string;
};

export type DemoState = {
  snapshot: RendererSnapshot;
  applied: readonly AppliedAction[];
  events: DemoEvent[];
  demoIdle: boolean;
  expiredAction: RendererAction;
  controlId: string;
  timings: {
    idleAfterMs: number;
    countdownMs: number;
  };
};

export type DemoBridge = {
  ready(): void;
  onState(listener: (state: DemoState) => void): () => void;
  reportActivity(targetId?: string): Promise<void>;
  openWindow(): Promise<void>;
  setDemoIdle(idle: boolean): Promise<void>;
  setExpiredAction(action: RendererAction): Promise<void>;
};

export type { RendererAction };
