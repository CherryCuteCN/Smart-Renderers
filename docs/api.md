# API

`createSmartRenderers` is a facade over `createRuntime` + `createManager`. Call it from the Electron **main** process.

For a shortest working snippet, see the [root README](../README.md).

## Options

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

## Methods

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

`attachContents` tracks `webContents.id` as the target id, binds a default Electron handle, and returns a function that untracks it.

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
