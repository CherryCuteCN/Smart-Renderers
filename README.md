# Smart-Renderers

A TypeScript plugin for Electron main-process renderer management. It watches tracked windows / webviews / offscreen renderers, starts a countdown after they go idle, and then throttles, hibernates, or destroys them. Activity restores reversible actions.

Install the root package to get the full public API.

## Requirements

- Node.js 20+
- ESM (`"type": "module"`)
- Electron 20+ is an optional peer. Outside Electron the runtime still works; renderer actions fall back to an in-memory port unless you supply your own.

## Install

```bash
pnpm add smart-renderers
# or: npm install smart-renderers
```

This package re-exports the private workspace packages `@smart-renderers/core` (idle + countdown) and `@smart-renderers/manager` (actions). They are bundled into the published tarball and are not installed separately.

## How it works

Each tracked target moves through a small state machine:

1. **Active** — after `track()` or `reportActivity()`.
2. **Countdown** — after `idleAfterMs` (default `0`, so the next timer tick). The snapshot marks the target idle and emits `countdown.started`.
3. **Expired** — when Chromium `powerMonitor` reports system idle / locked for `countdownMs` (default 15 minutes). Emits `countdown.expired`. The manager then applies the policy action.
4. **Back to active** — `reportActivity()` or a re-`track()` emits `countdown.cancelled` with `reason: "activity"` and reverts `throttle` / `hibernate`. `destroy` is not reverted.

`untrack()` removes the target. If it was idle, the runtime emits `countdown.cancelled` with `reason: "untracked"` and the manager drops applied state without restoring the window.

Actions only run when the snapshot says the process is renderer-capable (Electron **browser** / main process).

## Quick start

Call this from the Electron **main** process:

```ts
import { BrowserWindow } from "electron";
import { attachContents, createSmartRenderers } from "smart-renderers";

const renderers = createSmartRenderers({
  countdownMs: 15 * 60 * 1000,
  idleAfterMs: 0,
  policy: {
    onExpired: "hibernate",
    revertOnActivity: true,
    untrackOnDestroy: true,
  },
});

const window = new BrowserWindow({ show: true });
const detach = attachContents(renderers, window.webContents, window);

window.on("focus", () => {
  renderers.reportActivity(String(window.webContents.id));
});

window.on("closed", () => {
  detach();
});

// Later
renderers.dispose();
```

`attachContents` tracks `webContents.id` as the target id, binds a default Electron handle, and returns a function that untracks it.

## `createSmartRenderers`

Facade over `createRuntime` + `createManager`.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `countdownMs` | `15 * 60 * 1000` | Idle threshold used with `powerMonitor.getSystemIdleState`. |
| `idleAfterMs` | `0` | Grace period after activity before the countdown starts. |
| `clock` | system clock | Inject `now` / `setTimeout` for tests. |
| `idle` | Electron `powerMonitor` when available | Custom idle source. |
| `host` | `detectAvailability()` | Override Electron / process-type detection. |
| `actions` | Electron port, else memory port | How actions are applied. |
| `policy.onExpired` | `"hibernate"` | `"throttle"`, `"hibernate"`, `"destroy"`, or a function per target. |
| `policy.revertOnActivity` | `true` | Revert throttle / hibernate when activity is reported. |
| `policy.untrackOnDestroy` | `true` | `untrack` after a successful destroy. |
| `operators` | `[]` | Extra listeners for core countdown events. |
| `onOperatorError` | — | Called when an operator throws. |

### Methods

| Method | Purpose |
| --- | --- |
| `track(input, handle?)` | Start watching a target. Optional handle is bound in the same call. |
| `untrack(id)` | Stop watching and unbind. |
| `reportActivity(id)` | Mark the target active; may revert an applied action. |
| `bind` / `unbind` | Attach or detach a `TargetHandle` without changing track state. |
| `register` / `unregister` | Add or remove a named operator. |
| `getSnapshot()` | Current targets, countdown phases, and availability. |
| `getApplied()` | Actions currently applied. |
| `subscribe(listener)` | Core + manager events. |
| `subscribeRuntime` / `subscribeManager` | Split subscriptions. |
| `dispose()` | Unsubscribe, clear timers, reject later use. |
| `runtime` / `manager` | The underlying instances. |

`TrackInput`: `{ id: string; pid: number; kind?: "window" | "webview" | "offscreen" | "background" }`. Kind defaults to `"window"`.

## Electron actions

Default handles (`createContentsHandle` / `attachContents`):

| Action | Effect | Reversible |
| --- | --- | --- |
| `throttle` | `setBackgroundThrottling(true)`; offscreen targets also drop to 1 fps | Yes |
| `hibernate` | Throttle, then mute audio and `hide()` a visible `BrowserWindow` | Yes |
| `destroy` | `window.destroy()` or `webContents.close()` | No |

Restore unmutes, puts back the offscreen frame rate, and shows the window with `showInactive` when available.

You can bind a custom handle instead:

```ts
renderers.track(
  { id: "preview", pid: process.pid, kind: "offscreen" },
  {
    throttle: () => contents.setFrameRate(1),
    hibernate: () => contents.setFrameRate(1),
    restore: () => contents.setFrameRate(30),
    destroy: () => contents.close(),
  },
);
```

## Events

`subscribe` receives both layers.

**Runtime**

- `countdown.started`
- `countdown.cancelled` — `reason: "activity" | "untracked"`
- `countdown.expired`

**Manager**

- `action.applied`
- `action.reverted`
- `action.failed` — `action` is the renderer action or `"revert"`

Every event includes the `RendererSnapshot` at emit time.

```ts
renderers.subscribe((event) => {
  if (event.type === "action.applied") {
    console.log(event.action, event.targetId);
  }
});
```

## Snapshot

`getSnapshot()` returns:

```ts
{
  schema: "smart-renderers/snapshot/1",
  observedAt: number,
  availability: {
    electron: boolean,
    processType: "browser" | "renderer" | "utility" | "unknown",
    rendererCapable: boolean,
  },
  targets: Array<{
    id: string,
    pid: number,
    kind: "window" | "webview" | "offscreen" | "background",
    lastActivityAt: number,
    idle: boolean,
    countdown: {
      phase: "inactive" | "running" | "expired",
      durationMs: number,
      startedAt?: number,
      remainingMs?: number,
      expiresAt?: number,
    },
  }>,
  aggregate: { targetCount: number, idleCount: number, allIdle: boolean },
}
```

## Lower-level API

Use these when you want the pieces unbundled:

```ts
import {
  createRuntime,
  createManager,
  createMemoryActionPort,
  tryCreateElectronIdleSource,
} from "smart-renderers";

const runtime = createRuntime({ countdownMs: 60_000 });
const manager = createManager({
  runtime,
  actions: createMemoryActionPort(),
  policy: { onExpired: (target) => (target.kind === "window" ? "hibernate" : "throttle") },
});
```

| Export | Role |
| --- | --- |
| `createRuntime` | Track targets and emit countdown events. |
| `detectAvailability` | Read Electron + `process.type`. |
| `createElectronIdleSource` / `tryCreateElectronIdleSource` | Wrap `powerMonitor`. |
| `createManager` | Apply / revert actions from runtime events. |
| `createElectronActionPort` / `tryCreateElectronActionPort` | Resolve `webContents` by numeric id. |
| `createMemoryActionPort` / `createHandleRegistry` | Bind handles in tests or custom hosts. |
| `isBindableActionPort` | Type guard for `bind` / `unbind`. |
| `createContentsHandle` | Default throttle / hibernate / destroy / restore. |
| `attachContents` | Track + bind a `WebContents` in one call. |

## Packages

| Package | Responsibility |
| --- | --- |
| `smart-renderers` | Unified entry (`createSmartRenderers`, `attachContents`, re-exports). |
| `@smart-renderers/core` | Idle detection, countdown, snapshots. |
| `@smart-renderers/manager` | Action ports, policy, operators. |

Only `smart-renderers` is published to npm. The scoped packages are `private` workspace packages and are bundled into `dist`.

## Scripts

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm pack
```

## License

MIT
