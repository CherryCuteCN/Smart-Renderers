import { app, BrowserWindow } from "electron";
import {
  attachContents,
  createSmartRenderers,
  detectAvailability,
  tryCreateElectronIdleSource,
} from "smart-renderers";
import { createControllableIdleSource } from "./demo-idle.js";

const COUNTDOWN_MS = 1_000;

type Check = {
  name: string;
  ok: boolean;
  detail?: string;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntil(
  label: string,
  probe: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (probe()) {
      return;
    }
    await wait(20);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function createWindow(title: string, show = false): BrowserWindow {
  return new BrowserWindow({
    width: 320,
    height: 240,
    title,
    show,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

function closeWindow(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.destroy();
  }
}

function scenarioElectronRuntime(): Check[] {
  const availability = detectAvailability();
  const idle = tryCreateElectronIdleSource();
  const idleState = idle?.getIdleState(1);
  return [
    {
      name: "detectAvailability reports electron main process",
      ok:
        availability.electron &&
        availability.processType === "browser" &&
        availability.rendererCapable,
      detail: JSON.stringify(availability),
    },
    {
      name: "powerMonitor idle source is available",
      ok: idle !== undefined,
    },
    {
      name: "powerMonitor returns a valid idle state",
      ok:
        idleState === "active" ||
        idleState === "idle" ||
        idleState === "locked" ||
        idleState === "unknown",
      detail: `state=${idleState ?? "(missing)"}`,
    },
  ];
}

function recordEvents(
  renderers: ReturnType<typeof createSmartRenderers>,
): string[] {
  const events: string[] = [];
  renderers.subscribe((event) => {
    const extra =
      event.type === "action.applied" || event.type === "action.failed"
        ? `:${event.action}`
        : event.type === "countdown.cancelled"
          ? `:${event.reason}`
          : "";
    events.push(`${event.type}${extra}:${event.targetId}`);
  });
  return events;
}

async function scenarioIdleWindowIsClosed(): Promise<Check[]> {
  const idle = createControllableIdleSource();
  const renderers = createSmartRenderers({
    countdownMs: COUNTDOWN_MS,
    idleAfterMs: 0,
    idle: idle.source,
    policy: { onExpired: "destroy", untrackOnDestroy: true },
  });
  const events = recordEvents(renderers);
  const window = createWindow("e2e · idle closes");
  const id = String(window.webContents.id);
  attachContents(renderers, window.webContents, window);
  await window.loadURL("about:blank");
  await waitUntil("countdown.started", () =>
    events.includes(`countdown.started:${id}`),
  );

  idle.setIdleTimeSeconds(1);
  await waitUntil("idle window destroyed", () => window.isDestroyed());

  const checks: Check[] = [
    {
      name: "idle target expires",
      ok: events.includes(`countdown.expired:${id}`),
      detail: events.join(", "),
    },
    {
      name: "idle window is closed",
      ok:
        window.isDestroyed() && events.includes(`action.applied:destroy:${id}`),
    },
    {
      name: "closed idle window is untracked",
      ok: renderers.getSnapshot().targets.length === 0,
    },
  ];
  renderers.dispose();
  return checks;
}

async function scenarioThrottleKeepsWindowVisible(): Promise<Check[]> {
  const idle = createControllableIdleSource();
  const renderers = createSmartRenderers({
    countdownMs: COUNTDOWN_MS,
    idleAfterMs: 0,
    idle: idle.source,
    policy: { onExpired: "throttle", revertOnActivity: true },
  });
  const events = recordEvents(renderers);
  const window = createWindow("e2e · throttle", true);
  const id = String(window.webContents.id);
  attachContents(renderers, window.webContents, window);
  await window.loadURL("about:blank");
  await waitUntil("throttle window visible", () => window.isVisible());
  await waitUntil("countdown.started", () =>
    events.includes(`countdown.started:${id}`),
  );

  idle.setIdleTimeSeconds(1);
  await waitUntil("throttle applied", () =>
    events.includes(`action.applied:throttle:${id}`),
  );

  const checks: Check[] = [
    {
      name: "throttle expires without hiding the window",
      ok:
        !window.isDestroyed() &&
        window.isVisible() &&
        window.webContents.backgroundThrottling === true &&
        events.includes(`countdown.expired:${id}`),
      detail: `visible=${window.isVisible()} throttling=${window.webContents.backgroundThrottling}`,
    },
  ];
  renderers.dispose();
  closeWindow(window);
  return checks;
}

async function scenarioHibernateAndRestore(): Promise<Check[]> {
  const idle = createControllableIdleSource();
  const renderers = createSmartRenderers({
    countdownMs: COUNTDOWN_MS,
    idleAfterMs: 0,
    idle: idle.source,
    policy: { onExpired: "hibernate", revertOnActivity: true },
  });
  const events = recordEvents(renderers);
  const window = createWindow("e2e · hibernate", true);
  const id = String(window.webContents.id);
  attachContents(renderers, window.webContents, window);
  await window.loadURL("about:blank");
  await waitUntil("hibernate window visible", () => window.isVisible());
  await waitUntil("countdown.started", () =>
    events.includes(`countdown.started:${id}`),
  );

  idle.setIdleTimeSeconds(1);
  await waitUntil("hibernate applied", () =>
    events.includes(`action.applied:hibernate:${id}`),
  );

  const afterHibernate = {
    muted: window.webContents.isAudioMuted(),
    hidden: !window.isVisible(),
    throttled: window.webContents.backgroundThrottling === true,
  };

  renderers.reportActivity(id);
  await waitUntil("hibernate reverted", () =>
    events.includes(`action.reverted:${id}`),
  );

  const afterRestore = {
    unmuted: !window.webContents.isAudioMuted(),
    shown: window.isVisible(),
    cancelled: events.includes(`countdown.cancelled:activity:${id}`),
  };

  const checks: Check[] = [
    {
      name: "hibernate mutes, hides, and throttles a visible window",
      ok: afterHibernate.muted && afterHibernate.hidden && afterHibernate.throttled,
      detail: JSON.stringify(afterHibernate),
    },
    {
      name: "activity restores mute and visibility",
      ok: afterRestore.unmuted && afterRestore.shown && afterRestore.cancelled,
      detail: JSON.stringify(afterRestore),
    },
  ];
  renderers.dispose();
  closeWindow(window);
  return checks;
}

async function scenarioSiblingEndDoesNotMisjudgeInUsePage(): Promise<Check[]> {
  const idle = createControllableIdleSource();
  const renderers = createSmartRenderers({
    countdownMs: COUNTDOWN_MS,
    idleAfterMs: 400,
    idle: idle.source,
    policy: { onExpired: "destroy", untrackOnDestroy: true },
  });
  const events = recordEvents(renderers);
  const pageA = createWindow("e2e · page A ends");
  const pageB = createWindow("e2e · page B in use");
  const idA = String(pageA.webContents.id);
  const idB = String(pageB.webContents.id);
  const detachA = attachContents(renderers, pageA.webContents, pageA);
  attachContents(renderers, pageB.webContents, pageB);
  await Promise.all([pageA.loadURL("about:blank"), pageB.loadURL("about:blank")]);
  await waitUntil("both pages tracked", () => {
    return (
      events.includes(`countdown.started:${idA}`) &&
      events.includes(`countdown.started:${idB}`)
    );
  });

  const before = renderers.getSnapshot();
  const sharedPid =
    before.targets.length === 2 &&
    before.targets[0]?.pid === before.targets[1]?.pid &&
    before.targets[0]?.pid === process.pid &&
    idA !== idB;

  renderers.reportActivity(idB);
  detachA();
  if (!pageA.isDestroyed()) {
    pageA.destroy();
  }
  await waitUntil("page A ended", () => pageA.isDestroyed());

  idle.setIdleTimeSeconds(1);
  await wait(120);

  const mid = renderers.getSnapshot();
  const midIds = mid.targets.map((target) => target.id);
  const midEvents = [...events];
  const startedB = midEvents.filter((event) => event === `countdown.started:${idB}`).length;
  const bAfterAEnded = {
    alive: !pageB.isDestroyed(),
    tracked: midIds.length === 1 && midIds[0] === idB,
    notDestroyedByPlugin: !midEvents.includes(`action.applied:destroy:${idB}`),
    notExpired: !midEvents.includes(`countdown.expired:${idB}`),
    notUntracked: !midEvents.includes(`countdown.cancelled:untracked:${idB}`),
  };

  await waitUntil(
    "page B starts a new countdown after its in-use grace",
    () =>
      events.filter((event) => event === `countdown.started:${idB}`).length >
      startedB,
    1_000,
  );
  idle.setIdleTimeSeconds(1);
  await waitUntil("page B closed after it became idle", () => pageB.isDestroyed());

  const checks: Check[] = [
    {
      name: "two pages share one renderer pid and have distinct ids",
      ok: sharedPid,
      detail: `A=${idA} B=${idB} pid=${process.pid}`,
    },
    {
      name: "page A ending does not close in-use page B",
      ok:
        pageA.isDestroyed() &&
        bAfterAEnded.alive &&
        bAfterAEnded.tracked &&
        bAfterAEnded.notDestroyedByPlugin &&
        bAfterAEnded.notExpired &&
        bAfterAEnded.notUntracked,
      detail: `after A ended: tracked=${midIds.join(",") || "(none)"} events=${midEvents.join(", ")}`,
    },
    {
      name: "page B is still closed later when it actually goes idle",
      ok:
        pageB.isDestroyed() &&
        events.includes(`countdown.expired:${idB}`) &&
        events.includes(`action.applied:destroy:${idB}`),
      detail: events.join(", "),
    },
  ];
  renderers.dispose();
  return checks;
}

function printChecks(title: string, checks: Check[]): boolean {
  console.log(`\n== ${title} ==`);
  let passed = true;
  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    console.log(
      `${mark}  ${check.name}${check.detail ? `  (${check.detail})` : ""}`,
    );
    passed &&= check.ok;
  }
  return passed;
}

app.on("window-all-closed", () => {
  return;
});

void app.whenReady().then(async () => {
  let passed = true;
  try {
    passed = printChecks("electron runtime", scenarioElectronRuntime()) && passed;
    passed =
      printChecks(
        "idle page is closed",
        await scenarioIdleWindowIsClosed(),
      ) && passed;
    passed =
      printChecks(
        "throttle keeps the window visible",
        await scenarioThrottleKeepsWindowVisible(),
      ) && passed;
    passed =
      printChecks(
        "hibernate and restore a live window",
        await scenarioHibernateAndRestore(),
      ) && passed;
    passed =
      printChecks(
        "ending one shared-renderer page does not misjudge the page still in use",
        await scenarioSiblingEndDoesNotMisjudgeInUsePage(),
      ) && passed;
  } catch (error) {
    passed = false;
    console.error("E2E error:", error);
  }

  console.log(passed ? "\nexample e2e: PASS" : "\nexample e2e: FAIL");
  app.exit(passed ? 0 : 1);
});
