import {
  createRuntime,
  type CoreEvent,
  type Runtime,
  type RuntimeOptions,
  type TrackInput,
} from "@smart-renderers/core";
import {
  createManager,
  createMemoryActionPort,
  isBindableActionPort,
  tryCreateElectronActionPort,
  type ActionPort,
  type Manager,
  type ManagerEvent,
  type ManagerOptions,
  type TargetHandle,
} from "@smart-renderers/manager";

export type SmartRenderersOptions = RuntimeOptions & {
  actions?: ActionPort;
  policy?: ManagerOptions["policy"];
  operators?: ManagerOptions["operators"];
  onOperatorError?: ManagerOptions["onOperatorError"];
};

export type SmartRenderersEvent = CoreEvent | ManagerEvent;

export type SmartRenderers = {
  readonly runtime: Runtime;
  readonly manager: Manager;
  track(input: TrackInput, handle?: TargetHandle): void;
  untrack(id: string): void;
  reportActivity: Runtime["reportActivity"];
  bind: Manager["bind"];
  unbind: Manager["unbind"];
  register: Manager["register"];
  unregister: Manager["unregister"];
  getSnapshot: Runtime["getSnapshot"];
  getApplied: Manager["getApplied"];
  subscribe(listener: (event: SmartRenderersEvent) => void): () => void;
  subscribeRuntime: Runtime["subscribe"];
  subscribeManager: Manager["subscribe"];
  dispose(): void;
};

export function createSmartRenderers(
  options: SmartRenderersOptions = {},
): SmartRenderers {
  const { actions: providedActions, policy, operators, onOperatorError, ...runtimeOptions } =
    options;

  const runtime = createRuntime(runtimeOptions);
  const actions =
    providedActions ?? tryCreateElectronActionPort() ?? createMemoryActionPort();
  const bindable = isBindableActionPort(actions);
  const manager = createManager({
    runtime,
    actions,
    policy,
    operators,
    onOperatorError,
  });

  return {
    runtime,
    manager,
    track(input, handle) {
      runtime.track(input);
      if (!handle) {
        return;
      }
      if (!bindable) {
        throw new Error("action port does not support bind");
      }
      manager.bind(input.id, handle);
    },
    untrack(id) {
      if (bindable) {
        manager.unbind(id);
      }
      runtime.untrack(id);
    },
    reportActivity(id) {
      runtime.reportActivity(id);
    },
    bind(id, handle) {
      manager.bind(id, handle);
    },
    unbind(id) {
      manager.unbind(id);
    },
    register(operator) {
      manager.register(operator);
    },
    unregister(name) {
      manager.unregister(name);
    },
    getSnapshot() {
      return runtime.getSnapshot();
    },
    getApplied() {
      return manager.getApplied();
    },
    subscribe(listener) {
      const offRuntime = runtime.subscribe(listener);
      const offManager = manager.subscribe(listener);
      return () => {
        offRuntime();
        offManager();
      };
    },
    subscribeRuntime(listener) {
      return runtime.subscribe(listener);
    },
    subscribeManager(listener) {
      return manager.subscribe(listener);
    },
    dispose() {
      manager.dispose();
      runtime.dispose();
    },
  };
}
