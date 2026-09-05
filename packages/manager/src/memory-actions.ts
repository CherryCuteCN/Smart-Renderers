import type {
  ActionPort,
  BindableActionPort,
  RendererAction,
  TargetHandle,
} from "./types";

export type HandleRegistry = BindableActionPort & {
  get(id: string): TargetHandle | undefined;
};

export function createHandleRegistry(): HandleRegistry {
  const handles = new Map<string, TargetHandle>();
  return {
    bind(id, handle) {
      handles.set(id, handle);
    },
    unbind(id) {
      handles.delete(id);
    },
    get(id) {
      return handles.get(id);
    },
    apply(action, target) {
      return callHandle(handles, target.id, action);
    },
    revert(target) {
      const handle = handles.get(target.id);
      return handle?.restore?.();
    },
  };
}

export function createMemoryActionPort(): BindableActionPort {
  return createHandleRegistry();
}

export function isBindableActionPort(
  port: ActionPort,
): port is BindableActionPort {
  return (
    "bind" in port &&
    typeof port.bind === "function" &&
    "unbind" in port &&
    typeof port.unbind === "function"
  );
}

function callHandle(
  handles: Map<string, TargetHandle>,
  id: string,
  action: RendererAction,
): void | Promise<void> {
  const handle = handles.get(id);
  if (!handle) {
    throw new Error(`no target handle bound: ${id}`);
  }
  const run = handle[action];
  if (!run) {
    throw new Error(`target ${id} does not implement ${action}`);
  }
  return run();
}
