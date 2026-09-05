# Smart-Renderers

English | [简体中文](./README.zh-CN.md)

[![npm latest](https://img.shields.io/npm/v/smart-renderers/latest?label=latest)](https://www.npmjs.com/package/smart-renderers)
[![npm dev](https://img.shields.io/npm/v/smart-renderers/dev?label=dev)](https://www.npmjs.com/package/smart-renderers?activeTab=versions)

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

To try the latest `dev` tag instead of the latest official release:

```bash
pnpm add smart-renderers@dev
```

Version badges above read [npm `dist-tags`](https://www.npmjs.com/package/smart-renderers?activeTab=versions) (`latest` and `dev`) and update automatically.

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

## Docs

- [How it works](docs/how-it-works.md)
- [API](docs/api.md) — options, methods, events, snapshots, lower-level exports
- [Electron actions](docs/electron.md)
- [Packages](docs/packages.md)

## Example

`examples/electron` is a live Electron app that attaches `smart-renderers` to real `BrowserWindow`s. It shortens the timers, injects a controllable idle source, and shows countdown events plus throttle / hibernate / destroy on screen.

```bash
pnpm example:electron
```

See [examples/electron/README.md](examples/electron/README.md).

## License

MIT
