# How it works

Each tracked target moves through a small state machine:

1. **Active** — after `track()` or `reportActivity()`.
2. **Countdown** — after `idleAfterMs` (default `0`, so the next timer tick). The snapshot marks the target idle and emits `countdown.started`.
3. **Expired** — when Chromium `powerMonitor` reports system idle / locked for `countdownMs` (default 15 minutes). Emits `countdown.expired`. The manager then applies the policy action.
4. **Back to active** — `reportActivity()` or a re-`track()` emits `countdown.cancelled` with `reason: "activity"` and reverts `throttle` / `hibernate`. `destroy` is not reverted.

`untrack()` removes the target. If it was idle, the runtime emits `countdown.cancelled` with `reason: "untracked"` and the manager drops applied state without restoring the window.

Actions only run when the snapshot says the process is renderer-capable (Electron **browser** / main process).
