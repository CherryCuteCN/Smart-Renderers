import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  attachContents,
  createSmartRenderers,
  type RendererAction,
} from "smart-renderers";
import { createControllableIdleSource } from "./demo-idle.js";
import {
  COUNTDOWN_MS,
  IDLE_AFTER_MS,
  IPC,
  type DemoEvent,
  type DemoState,
} from "./shared.js";

const here = dirname(fileURLToPath(import.meta.url));
const MAX_EVENTS = 40;

const demoIdle = createControllableIdleSource();
const events: DemoEvent[] = [];
const detachById = new Map<string, () => void>();

let expiredAction: RendererAction = "hibernate";
let controlId = "";
let probeCount = 0;

const renderers = createSmartRenderers({
  countdownMs: COUNTDOWN_MS,
  idleAfterMs: IDLE_AFTER_MS,
  idle: demoIdle.source,
  policy: {
    onExpired: (target) => (target.id === controlId ? "throttle" : expiredAction),
    revertOnActivity: true,
    untrackOnDestroy: true,
  },
});

function pushEvent(event: DemoEvent): void {
  events.unshift(event);
  events.length = Math.min(events.length, MAX_EVENTS);
}

function state(): DemoState {
  return {
    snapshot: renderers.getSnapshot(),
    applied: renderers.getApplied(),
    events: [...events],
    demoIdle: demoIdle.isSystemIdle(),
    expiredAction,
    controlId,
    timings: {
      idleAfterMs: IDLE_AFTER_MS,
      countdownMs: COUNTDOWN_MS,
    },
  };
}

function broadcast(): void {
  const next = state();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.state, next);
    }
  }
}

function targetIdOf(contents: Electron.WebContents): string {
  return String(contents.id);
}

function createWindow(role: "control" | "probe"): BrowserWindow {
  const window = new BrowserWindow({
    width: role === "control" ? 960 : 760,
    height: role === "control" ? 820 : 680,
    minWidth: 640,
    minHeight: 520,
    title:
      role === "control"
        ? "smart-renderers · control"
        : `smart-renderers · probe ${++probeCount}`,
    backgroundColor: "#101218",
    show: true,
    webPreferences: {
      preload: join(here, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const id = targetIdOf(window.webContents);
  if (role === "control") {
    controlId = id;
  }

  const detach = attachContents(renderers, window.webContents, window);
  detachById.set(id, detach);

  window.on("focus", () => {
    renderers.reportActivity(id);
    broadcast();
  });

  window.on("closed", () => {
    detachById.get(id)?.();
    detachById.delete(id);
    broadcast();
  });

  void window.loadFile(join(here, "index.html"), { query: { role, id } });
  return window;
}

function isRendererAction(value: unknown): value is RendererAction {
  return value === "throttle" || value === "hibernate" || value === "destroy";
}

renderers.subscribe((event) => {
  const detail =
    event.type === "countdown.cancelled"
      ? event.reason
      : event.type === "action.applied"
        ? event.action
        : event.type === "action.failed"
          ? `${event.action}: ${String(event.error)}`
          : "";
  pushEvent({
    at: Date.now(),
    type: event.type,
    targetId: event.targetId,
    detail,
  });
  broadcast();
});

ipcMain.on(IPC.ready, (event) => {
  event.sender.send(IPC.state, state());
});

ipcMain.handle(IPC.reportActivity, (event, requestedId?: unknown) => {
  const id =
    typeof requestedId === "string" && requestedId.length > 0
      ? requestedId
      : targetIdOf(event.sender);
  demoIdle.setSystemIdle(false);
  renderers.reportActivity(id);
  broadcast();
});

ipcMain.handle(IPC.openWindow, () => {
  createWindow("probe");
  broadcast();
});

ipcMain.handle(IPC.setDemoIdle, (_event, idle: unknown) => {
  const next = idle === true;
  demoIdle.setSystemIdle(next);
  pushEvent({
    at: Date.now(),
    type: "demo.idle",
    detail: next ? "os-idle" : "os-active",
  });
  broadcast();
});

ipcMain.handle(IPC.setExpiredAction, (_event, action: unknown) => {
  if (!isRendererAction(action)) {
    throw new Error("invalid expired action");
  }
  expiredAction = action;
  pushEvent({
    at: Date.now(),
    type: "demo.policy",
    detail: action,
  });
  broadcast();
});

void app.whenReady().then(() => {
  createWindow("control");
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow("control");
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    renderers.reportActivity(targetIdOf(window.webContents));
    if (!window.isVisible()) {
      window.show();
    }
  }
  broadcast();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  renderers.dispose();
});
