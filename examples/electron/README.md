# Electron example

A small Electron app that wires the published `smart-renderers` API to real `BrowserWindow` instances so you can watch the idle → countdown → action → restore loop on a live process.

It is a playground, not a unit test. The library still runs in the Electron **main** process; the renderer is only a control surface.

## What it does

On launch the main process calls `createSmartRenderers` and `attachContents` for every window:

1. **Track** — each `webContents.id` becomes a target (`kind: "window"`).
2. **Countdown** — `2s` after `track()` or `reportActivity()`, the runtime marks the target idle and emits `countdown.started`.
3. **Expire** — when the idle source reports the OS as idle for `5s`, the runtime emits `countdown.expired` and the manager applies a policy action.
4. **Restore** — `reportActivity()`, window focus, or macOS dock activate reverts `throttle` / `hibernate`. `destroy` is not reverted.

Production apps normally feed Chromium `powerMonitor` (the library default). Waiting for a real machine-idle lock is a poor way to exercise the plugin, so this example **injects a controllable `IdleSource`**. The rest of the path is the real plugin: Electron action handles, `hibernate` hide + mute, `throttle` background throttling, and `destroy` on the window.

## What you can test

| Action | What you should see |
| --- | --- |
| `throttle` | `setBackgroundThrottling(true)` on the probe window. The on-screen `raf` counter may drop once that window is in the background. |
| `hibernate` (default for probes) | Probe window is muted and hidden. The control window stays up. **Wake** shows it again via `showInactive`. |
| `destroy` | Probe window is destroyed and untracked (`untrackOnDestroy: true`). |

The first window is the **control** window. Its expired action is always `throttle`, so the dashboard cannot hide or destroy itself. Extra **probe** windows use the action you pick in the UI.

The dashboard also prints:

- `detectAvailability()` — `electron`, `processType` (`browser`), `rendererCapable`
- per-target countdown phase / remaining time / applied action
- a live event log (`countdown.*` and `action.*`)

## Run

From the repository root (pnpm workspace):

```bash
pnpm install
pnpm example:electron
```

Or only the example package, after the library has been built:

```bash
pnpm build
pnpm --filter @smart-renderers/example-electron start
```

Automated checks against **real** `BrowserWindow`s (fake idle seconds, `countdownMs: 1000`):

```bash
pnpm example:electron:e2e
```

That runs two live scenarios in the example process:

1. An idle window expires and is destroyed.
2. Two pages share `process.pid` and stay distinct by `webContents.id`. Ending page A does not close page B while B is still in use; B is only destroyed later, when B itself goes idle.

Requires Node.js 20+ and a machine that can run Electron.

## Suggested walkthrough

1. Leave **OS active**. After two seconds every target should enter countdown `running`, but it should **not** expire.
2. Click **Simulate OS idle**. Remaining time counts down from five seconds.
3. When a probe expires with **hibernate**, that window disappears. The control window stays visible and logs `action.applied`.
4. Click **Wake** on the hidden target (or **Report activity**). The probe comes back; the log shows `countdown.cancelled` / `action.reverted`.
5. Open another probe, switch policy to **destroy**, idle again, and confirm the window is gone from the table.
6. Switch policy to **throttle**, idle a probe, then put that window in the background and watch the `raf` readout.

Focusing a window also calls `reportActivity` for that target, which matches the README quick start.

## Layout

```
examples/electron/
  src/main.ts        createSmartRenderers, attachContents, IPC
  src/demo-idle.ts   controllable IdleSource used instead of powerMonitor
  src/preload.ts     contextBridge
  src/renderer.ts    dashboard
  src/shared.ts      timings, IPC names, state types
```

Timings are intentionally short (`idleAfterMs = 2000`, `countdownMs = 5000`). The published defaults are `0` and `15 minutes`.

## Notes

- Import the workspace package `smart-renderers` the same way a consumer would. `start` compiles this example and launches `electron .`.
- Preload keeps `contextIsolation` on. `sandbox` is off so the ESM preload can load under `"type": "module"`.
- This package is `private` and is not published.
