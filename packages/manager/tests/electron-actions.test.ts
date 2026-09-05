import { expect, test } from "vitest";
import {
  createContentsHandle,
  createElectronActionPort,
} from "../src/index";
import type {
  BrowserWindowLike,
  WebContentsLike,
} from "../src/index";
import type { RendererSnapshot, TrackedTarget } from "@smart-renderers/core";

function target(id: string, kind: TrackedTarget["kind"] = "window"): TrackedTarget {
  return {
    id,
    pid: 1,
    kind,
    lastActivityAt: 0,
    idle: true,
    countdown: { phase: "expired", durationMs: 1000, remainingMs: 0 },
  };
}

function snapshot(): RendererSnapshot {
  return {
    schema: "smart-renderers/snapshot/1",
    observedAt: 0,
    availability: {
      electron: true,
      processType: "browser",
      rendererCapable: true,
    },
    targets: [],
    aggregate: { targetCount: 0, idleCount: 0, allIdle: false },
  };
}

function fakeContents(): WebContentsLike & {
  destroyed: boolean;
  muted: boolean;
  throttling: boolean;
  frameRate: number;
  closed: boolean;
} {
  return {
    id: 1,
    destroyed: false,
    muted: false,
    throttling: false,
    frameRate: 30,
    closed: false,
    isDestroyed() {
      return this.destroyed;
    },
    isOffscreen() {
      return false;
    },
    isAudioMuted() {
      return this.muted;
    },
    setAudioMuted(muted) {
      this.muted = muted;
    },
    setBackgroundThrottling(value) {
      this.throttling = value;
    },
    getFrameRate() {
      return this.frameRate;
    },
    setFrameRate(fps) {
      this.frameRate = fps;
    },
    close() {
      this.closed = true;
      this.destroyed = true;
    },
  };
}

function fakeWindow(): BrowserWindowLike & {
  destroyed: boolean;
  visible: boolean;
} {
  return {
    destroyed: false,
    visible: true,
    isDestroyed() {
      return this.destroyed;
    },
    isVisible() {
      return this.visible;
    },
    hide() {
      this.visible = false;
    },
    show() {
      this.visible = true;
    },
    showInactive() {
      this.visible = true;
    },
    destroy() {
      this.destroyed = true;
      this.visible = false;
    },
  };
}

test("hibernate hides, mutes, and throttles a window", async () => {
  const contents = fakeContents();
  const window = fakeWindow();
  const port = createElectronActionPort({
    webContents: {
      fromId: (id) => (id === 1 ? contents : undefined),
    },
    BrowserWindow: {
      fromWebContents: () => window,
    },
  });

  await port.apply("hibernate", target("1"), snapshot());

  expect(contents.throttling).toBe(true);
  expect(contents.muted).toBe(true);
  expect(window.visible).toBe(false);
});

test("activity restore undoes hibernate", async () => {
  const contents = fakeContents();
  const window = fakeWindow();
  const port = createElectronActionPort({
    webContents: {
      fromId: (id) => (id === 1 ? contents : undefined),
    },
    BrowserWindow: {
      fromWebContents: () => window,
    },
  });

  await port.apply("hibernate", target("1"), snapshot());
  await port.revert(target("1"), snapshot());

  expect(contents.muted).toBe(false);
  expect(window.visible).toBe(true);
});

test("destroy uses BrowserWindow.destroy", async () => {
  const contents = fakeContents();
  const window = fakeWindow();
  const port = createElectronActionPort({
    webContents: {
      fromId: (id) => (id === 1 ? contents : undefined),
    },
    BrowserWindow: {
      fromWebContents: () => window,
    },
  });

  await port.apply("destroy", target("1"), snapshot());

  expect(window.destroyed).toBe(true);
  expect(contents.closed).toBe(false);
});

test("offscreen throttle lowers frame rate", async () => {
  const contents = fakeContents();
  const handle = createContentsHandle(contents, undefined, "offscreen");

  await handle.throttle?.();

  expect(contents.throttling).toBe(true);
  expect(contents.frameRate).toBe(1);

  await handle.restore?.();
  expect(contents.frameRate).toBe(30);
});

test("bound handle wins over fromId", async () => {
  const contents = fakeContents();
  const calls: string[] = [];
  const port = createElectronActionPort({
    webContents: {
      fromId: () => contents,
    },
  });
  port.bind("custom", {
    hibernate() {
      calls.push("bound");
    },
  });

  await port.apply("hibernate", target("custom"), snapshot());

  expect(calls).toEqual(["bound"]);
  expect(contents.muted).toBe(false);
});

test("unresolved target throws", () => {
  const port = createElectronActionPort({});

  expect(() => port.apply("hibernate", target("missing"), snapshot())).toThrowError(
    /cannot resolve target/,
  );
});
