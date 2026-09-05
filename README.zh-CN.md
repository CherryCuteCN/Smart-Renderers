# Smart-Renderers

[English](./README.md) | 简体中文

[![npm latest](https://img.shields.io/npm/v/smart-renderers/latest?label=latest)](https://www.npmjs.com/package/smart-renderers)
[![npm dev](https://img.shields.io/npm/v/smart-renderers/dev?label=dev)](https://www.npmjs.com/package/smart-renderers?activeTab=versions)

面向 Electron 主进程的 TypeScript 渲染进程管理插件。它会监视已跟踪的窗口 / webview / 离屏渲染进程，在空闲后启动倒计时，然后节流、休眠或销毁它们。有活动时会恢复可逆操作。

安装根包即可获得完整公开 API。

## 环境要求

- Node.js 20+
- ESM（`"type": "module"`）
- Electron 20+ 为可选 peer。在 Electron 之外运行时仍可工作；除非自行提供，否则渲染进程动作会回退到内存端口。

## 安装

```bash
pnpm add smart-renderers
# 或：npm install smart-renderers
```

本包会再导出私有工作区包 `@smart-renderers/core`（空闲 + 倒计时）和 `@smart-renderers/manager`（动作）。它们已打进发布的 tarball，无需单独安装。

若要使用最新 `dev` 标签，而不是最新正式版：

```bash
pnpm add smart-renderers@dev
```

上方版本徽章读取 [npm `dist-tags`](https://www.npmjs.com/package/smart-renderers?activeTab=versions)（`latest` 与 `dev`），会自动更新。

## 快速开始

在 Electron **主进程**中调用：

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

// 之后
renderers.dispose();
```

`attachContents` 会把 `webContents.id` 当作目标 id，绑定默认 Electron handle，并返回用于取消跟踪的函数。

## 文档

- [工作原理](docs/how-it-works.md)
- [API](docs/api.md) — 选项、方法、事件、快照、底层导出
- [Electron 动作](docs/electron.md)
- [包结构](docs/packages.md)

## 示例

`examples/electron` 是一个可运行的 Electron 应用，会把 `smart-renderers` 挂到真实的 `BrowserWindow` 上。它缩短了计时器、注入了可控制的空闲源，并在界面上展示倒计时事件以及节流 / 休眠 / 销毁。

```bash
pnpm example:electron
```

详见 [examples/electron/README.md](examples/electron/README.md)。

## 许可证

MIT
