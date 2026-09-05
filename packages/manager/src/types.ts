import type {
  CoreEvent,
  RendererSnapshot,
  Runtime,
  TrackedTarget,
} from "@smart-renderers/core";

export const DEFAULT_EXPIRED_ACTION = "hibernate" as const;

export type RendererAction = "throttle" | "hibernate" | "destroy";

export type TargetHandle = {
  throttle?: () => void | Promise<void>;
  hibernate?: () => void | Promise<void>;
  restore?: () => void | Promise<void>;
  destroy?: () => void | Promise<void>;
};

export type ActionPort = {
  apply(
    action: RendererAction,
    target: TrackedTarget,
    snapshot: RendererSnapshot,
  ): void | Promise<void>;
  revert(
    target: TrackedTarget,
    snapshot: RendererSnapshot,
  ): void | Promise<void>;
};

export type BindableActionPort = ActionPort & {
  bind(id: string, handle: TargetHandle): void;
  unbind(id: string): void;
};

export type ExpiredAction =
  | RendererAction
  | ((target: TrackedTarget, snapshot: RendererSnapshot) => RendererAction);

export type ManagerPolicy = {
  onExpired?: ExpiredAction;
  revertOnActivity?: boolean;
  untrackOnDestroy?: boolean;
};

export type AppliedAction = {
  targetId: string;
  action: RendererAction;
  appliedAt: number;
};

export type ManagerEvent =
  | {
      type: "action.applied";
      action: RendererAction;
      targetId: string;
      snapshot: RendererSnapshot;
    }
  | {
      type: "action.reverted";
      targetId: string;
      snapshot: RendererSnapshot;
    }
  | {
      type: "action.failed";
      action: RendererAction | "revert";
      targetId: string;
      error: unknown;
      snapshot: RendererSnapshot;
    };

export type Operator = {
  readonly name: string;
  readonly interestedIn: readonly CoreEvent["type"][];
  handle(event: CoreEvent): Promise<void> | void;
};

export type ManagerOptions = {
  runtime: Runtime;
  actions?: ActionPort;
  policy?: ManagerPolicy;
  operators?: readonly Operator[];
  onOperatorError?: (
    error: unknown,
    operator: Operator,
    event: CoreEvent,
  ) => void;
};

export type Manager = {
  register(operator: Operator): void;
  unregister(name: string): void;
  bind(id: string, handle: TargetHandle): void;
  unbind(id: string): void;
  getSnapshot(): RendererSnapshot;
  getApplied(): readonly AppliedAction[];
  subscribe(listener: (event: ManagerEvent) => void): () => void;
  dispose(): void;
};
