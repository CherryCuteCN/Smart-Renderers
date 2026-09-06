import { createRequire } from "node:module";
import type { TargetKind } from "@smart-renderers/core";
import { createHandleRegistry } from "./memory-actions";
import type { BindableActionPort, RendererAction, TargetHandle } from "./types";

const nodeRequire = createRequire(import.meta.url);

export type WebContentsLike = {
  id?: number;
  isDestroyed?: () => boolean;
  isOffscreen?: () => boolean;
  isAudioMuted?: () => boolean;
  setAudioMuted?: (muted: boolean) => void;
  setBackgroundThrottling?: (value: boolean) => void;
  getFrameRate?: () => number;
  setFrameRate?: (fps: number) => void;
  close?: () => void;
};

export type BrowserWindowLike = {
  isDestroyed?: () => boolean;
  isVisible?: () => boolean;
  hide?: () => void;
  show?: () => void;
  showInactive?: () => void;
  destroy?: () => void;
};

export type ElectronActionHost = {
  webContents?: {
    fromId?: (id: number) => WebContentsLike | null | undefined;
  };
  BrowserWindow?: {
    fromWebContents?: (
      contents: WebContentsLike,
    ) => BrowserWindowLike | null | undefined;
  };
};

type SavedState = {
  muted?: boolean;
  didMute?: boolean;
  didHide?: boolean;
  frameRate?: number;
};

export function createContentsHandle(
  contents: WebContentsLike,
  window?: BrowserWindowLike,
  kind: TargetKind = "window",
): TargetHandle {
  let saved: SavedState | undefined;
  return {
    throttle() {
      saved ??= {};
      applyToContents("throttle", contents, window, kind, saved);
    },
    hibernate() {
      saved ??= {};
      applyToContents("hibernate", contents, window, kind, saved);
    },
    destroy() {
      applyToContents("destroy", contents, window, kind, {});
      saved = undefined;
    },
    restore() {
      if (!saved) {
        return;
      }
      revertContents(contents, window, saved);
      saved = undefined;
    },
  };
}

export function createElectronActionPort(
  host: ElectronActionHost,
): BindableActionPort {
  const registry = createHandleRegistry();
  const auto = new Map<string, TargetHandle>();

  function resolveHandle(id: string, kind: TargetKind): TargetHandle {
    const bound = registry.get(id);
    if (bound) {
      return bound;
    }
    const cached = auto.get(id);
    if (cached) {
      return cached;
    }
    const contents = lookupContents(host, id);
    if (!contents) {
      throw new Error(`cannot resolve target: ${id}`);
    }
    const window = host.BrowserWindow?.fromWebContents?.(contents) ?? undefined;
    const handle = createContentsHandle(contents, window ?? undefined, kind);
    auto.set(id, handle);
    return handle;
  }

  return {
    bind(id, handle) {
      auto.delete(id);
      registry.bind(id, handle);
    },
    unbind(id) {
      auto.delete(id);
      registry.unbind(id);
    },
    apply(action, target) {
      const handle = resolveHandle(target.id, target.kind);
      const run = handle[action];
      if (!run) {
        throw new Error(`target ${target.id} does not implement ${action}`);
      }
      return run();
    },
    revert(target) {
      const handle = registry.get(target.id) ?? auto.get(target.id);
      return handle?.restore?.();
    },
  };
}

export function tryCreateElectronActionPort(): BindableActionPort | undefined {
  const host = loadElectronHost();
  if (!host) {
    return undefined;
  }
  return createElectronActionPort(host);
}

function applyToContents(
  action: RendererAction,
  contents: WebContentsLike,
  window: BrowserWindowLike | undefined,
  kind: TargetKind,
  saved: SavedState,
): void {
  if (contents.isDestroyed?.()) {
    throw new Error("webContents is destroyed");
  }
  if (action === "destroy") {
    destroyTarget(contents, window);
    return;
  }
  throttleTarget(contents, kind, saved);
  if (action === "hibernate") {
    hibernateTarget(contents, window, kind, saved);
  }
}

function throttleTarget(
  contents: WebContentsLike,
  kind: TargetKind,
  saved: SavedState,
): void {
  contents.setBackgroundThrottling?.(true);
  const offscreen = kind === "offscreen" || contents.isOffscreen?.() === true;
  if (!offscreen || typeof contents.setFrameRate !== "function") {
    return;
  }
  if (saved.frameRate === undefined && typeof contents.getFrameRate === "function") {
    const current = contents.getFrameRate();
    if (Number.isFinite(current)) {
      saved.frameRate = current;
    }
  }
  contents.setFrameRate(1);
}

function hibernateTarget(
  contents: WebContentsLike,
  window: BrowserWindowLike | undefined,
  kind: TargetKind,
  saved: SavedState,
): void {
  if (typeof contents.setAudioMuted === "function") {
    if (!saved.didMute) {
      saved.muted = contents.isAudioMuted?.() ?? false;
      saved.didMute = true;
    }
    contents.setAudioMuted(true);
  }
  if (kind !== "window" || !window || window.isDestroyed?.()) {
    return;
  }
  const visible = window.isVisible?.() ?? true;
  if (!visible || typeof window.hide !== "function") {
    return;
  }
  saved.didHide = true;
  window.hide();
}

function destroyTarget(
  contents: WebContentsLike,
  window: BrowserWindowLike | undefined,
): void {
  if (window && !window.isDestroyed?.() && typeof window.destroy === "function") {
    window.destroy();
    return;
  }
  if (!contents.isDestroyed?.()) {
    contents.close?.();
  }
}

function revertContents(
  contents: WebContentsLike,
  window: BrowserWindowLike | undefined,
  saved: SavedState,
): void {
  if (contents.isDestroyed?.()) {
    return;
  }
  if (saved.didMute) {
    contents.setAudioMuted?.(saved.muted ?? false);
  }
  if (saved.frameRate !== undefined) {
    contents.setFrameRate?.(saved.frameRate);
  }
  if (!saved.didHide || !window || window.isDestroyed?.()) {
    return;
  }
  const show = window.showInactive ?? window.show;
  show?.call(window);
}

function lookupContents(
  host: ElectronActionHost,
  id: string,
): WebContentsLike | undefined {
  if (!/^\d+$/.test(id)) {
    return undefined;
  }
  return host.webContents?.fromId?.(Number(id)) ?? undefined;
}

function loadElectronHost(): ElectronActionHost | undefined {
  if (typeof (process.versions as { electron?: unknown }).electron !== "string") {
    return undefined;
  }
  try {
    return nodeRequire("electron") as ElectronActionHost;
  } catch {
    return undefined;
  }
}
