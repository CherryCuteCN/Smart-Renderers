# Electron actions

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
