import type { DemoState, RendererAction } from "./shared.js";

declare global {
  interface Window {
    demo: import("./shared.js").DemoBridge;
  }
}

const role = new URLSearchParams(location.search).get("role") ?? "probe";
const selfId = new URLSearchParams(location.search).get("id") ?? "";

function requireElement(selector: string): HTMLElement {
  const node = document.querySelector(selector);
  if (!(node instanceof HTMLElement)) {
    throw new Error(`${selector} missing`);
  }
  return node;
}

const root = requireElement("#app");

let frames = 0;
let lastFrameAt = performance.now();
let fps = 0;
let latest: DemoState | undefined;

function formatMs(value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return `${Math.max(0, Math.round(value / 100) / 10)}s`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString();
}

function appliedFor(state: DemoState, id: string): string {
  const row = state.applied.find((item) => item.targetId === id);
  return row?.action ?? "none";
}

function paint(state: DemoState): void {
  const availability = state.snapshot.availability;
  const self = state.snapshot.targets.find((target) => target.id === selfId);

  root.innerHTML = `
    <header class="hero">
      <div>
        <p class="eyebrow">${role === "control" ? "control window" : "probe window"}</p>
        <h1>smart-renderers live test</h1>
        <p class="lede">
          Tracks this <code>BrowserWindow</code>, starts a countdown after
          ${formatMs(state.timings.idleAfterMs)} of target inactivity, then applies a
          policy action when the injected idle source stays idle for
          ${formatMs(state.timings.countdownMs)}.
        </p>
      </div>
      <dl class="pills">
        <div><dt>electron</dt><dd>${availability.electron ? "yes" : "no"}</dd></div>
        <div><dt>process</dt><dd>${availability.processType}</dd></div>
        <div><dt>capable</dt><dd>${availability.rendererCapable ? "yes" : "no"}</dd></div>
        <div><dt>self id</dt><dd>${selfId || "—"}</dd></div>
        <div><dt>raf</dt><dd data-fps>${fps.toFixed(0)} fps</dd></div>
      </dl>
    </header>

    <section class="panel">
      <h2>Idle source</h2>
      <p>
        Expiry uses Chromium <code>powerMonitor</code> in production. This example
        injects a controllable source so you can flip OS idle without locking the machine.
      </p>
      <div class="row">
        <button type="button" data-idle="true" ${state.demoIdle ? "disabled" : ""}>Simulate OS idle</button>
        <button type="button" data-idle="false" ${state.demoIdle ? "" : "disabled"}>Simulate OS activity</button>
        <span class="badge ${state.demoIdle ? "wait" : "go"}">
          OS ${state.demoIdle ? "idle" : "active"}
        </span>
      </div>
    </section>

    <section class="panel">
      <h2>Policy for probe windows</h2>
      <p>
        The control window always throttles so this dashboard stays visible.
        Probe windows use the selected expired action.
      </p>
      <div class="row">
        ${(["throttle", "hibernate", "destroy"] as const)
          .map(
            (action) => `
              <button type="button" data-action="${action}" ${
                state.expiredAction === action ? "disabled" : ""
              }>${action}</button>
            `,
          )
          .join("")}
        <button type="button" data-open>Open probe window</button>
        <button type="button" data-wake-self>Report activity (this window)</button>
      </div>
    </section>

    <section class="panel">
      <h2>Tracked targets (${state.snapshot.aggregate.targetCount})</h2>
      <div class="table">
        <div class="thead">
          <span>id</span><span>kind</span><span>phase</span><span>remaining</span><span>applied</span><span></span>
        </div>
        ${state.snapshot.targets
          .map((target) => {
            const phase = target.countdown.phase;
            const mine = target.id === selfId;
            return `
              <div class="trow">
                <span>${target.id}${target.id === state.controlId ? " · control" : ""}${mine ? " · you" : ""}</span>
                <span>${target.kind}</span>
                <span class="badge ${phase === "expired" ? "stop" : phase === "running" ? "wait" : "go"}">${phase}</span>
                <span data-remaining="${target.id}">${formatMs(target.countdown.remainingMs)}</span>
                <span>${appliedFor(state, target.id)}</span>
                <span><button type="button" data-wake="${target.id}">Wake</button></span>
              </div>
            `;
          })
          .join("")}
      </div>
      <p class="fine">
        This window: idle=${self?.idle ?? "—"}, applied=${appliedFor(state, selfId)}.
        Aggregate idle ${state.snapshot.aggregate.idleCount}/${state.snapshot.aggregate.targetCount}.
      </p>
    </section>

    <section class="panel">
      <h2>Event log</h2>
      <ol class="log">
        ${state.events
          .map(
            (event) => `
              <li>
                <time>${formatTime(event.at)}</time>
                <code>${event.type}</code>
                <span>${event.targetId ?? "—"}</span>
                <span>${event.detail}</span>
              </li>
            `,
          )
          .join("")}
      </ol>
    </section>
  `;

  bind(root);
}

function bind(node: Element): void {
  node.querySelectorAll<HTMLButtonElement>("[data-idle]").forEach((button) => {
    button.addEventListener("click", () => {
      void window.demo.setDemoIdle(button.dataset.idle === "true");
    });
  });
  node.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void window.demo.setExpiredAction(button.dataset.action as RendererAction);
    });
  });
  node.querySelector<HTMLButtonElement>("[data-open]")?.addEventListener("click", () => {
    void window.demo.openWindow();
  });
  node.querySelector<HTMLButtonElement>("[data-wake-self]")?.addEventListener("click", () => {
    void window.demo.reportActivity(selfId);
  });
  node.querySelectorAll<HTMLButtonElement>("[data-wake]").forEach((button) => {
    button.addEventListener("click", () => {
      void window.demo.reportActivity(button.dataset.wake);
    });
  });
}

window.demo.onState((next) => {
  latest = next;
  paint(next);
});
window.demo.ready();

function refreshLiveFields(state: DemoState, now: number): void {
  const fpsNode = document.querySelector("[data-fps]");
  if (fpsNode) {
    fpsNode.textContent = `${fps.toFixed(0)} fps`;
  }
  for (const target of state.snapshot.targets) {
    const cell = document.querySelector(`[data-remaining="${target.id}"]`);
    if (!cell) {
      continue;
    }
    const remaining =
      target.countdown.phase === "running" && target.countdown.expiresAt
        ? Math.max(0, target.countdown.expiresAt - now)
        : target.countdown.remainingMs;
    cell.textContent = formatMs(remaining);
  }
}

const tick = (now: number) => {
  frames += 1;
  if (now - lastFrameAt >= 500) {
    fps = (frames * 1000) / (now - lastFrameAt);
    frames = 0;
    lastFrameAt = now;
  }
  if (latest) {
    refreshLiveFields(latest, Date.now());
  }
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
