export {
  createElectronIdleSource,
  createRuntime,
  DEFAULT_COUNTDOWN_MS,
  DEFAULT_IDLE_AFTER_MS,
  detectAvailability,
  SNAPSHOT_SCHEMA,
  systemClock,
  tryCreateElectronIdleSource,
} from "@smart-renderers/core";
export type {
  Availability,
  Clock,
  CoreEvent,
  CountdownCancelReason,
  CountdownPhase,
  ElectronHost,
  IdleSource,
  IdleState,
  PowerMonitorLike,
  ProcessType,
  RendererSnapshot,
  Runtime,
  RuntimeOptions,
  SnapshotSchema,
  TargetCountdown,
  TargetKind,
  TrackedTarget,
  TrackInput,
} from "@smart-renderers/core";

export {
  createContentsHandle,
  createElectronActionPort,
  createHandleRegistry,
  createManager,
  createMemoryActionPort,
  DEFAULT_EXPIRED_ACTION,
  isBindableActionPort,
  tryCreateElectronActionPort,
} from "@smart-renderers/manager";
export type {
  ActionPort,
  AppliedAction,
  BindableActionPort,
  BrowserWindowLike,
  ElectronActionHost,
  ExpiredAction,
  HandleRegistry,
  Manager,
  ManagerEvent,
  ManagerOptions,
  ManagerPolicy,
  Operator,
  RendererAction,
  TargetHandle,
  WebContentsLike,
} from "@smart-renderers/manager";

export { attachContents } from "./attach";
export type { AttachableContents, AttachTarget } from "./attach";
export { createSmartRenderers } from "./create";
export type {
  SmartRenderers,
  SmartRenderersEvent,
  SmartRenderersOptions,
} from "./create";
