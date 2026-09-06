import { createRequire } from "node:module";
import type { IdleSource, IdleState, PowerMonitorLike } from "./types";

const nodeRequire = createRequire(import.meta.url);

const POWER_EVENTS = [
  "suspend",
  "resume",
  "lock-screen",
  "unlock-screen",
  "user-did-become-active",
  "user-did-resign-active",
] as const;

export function createElectronIdleSource(
  powerMonitor: PowerMonitorLike,
): IdleSource {
  return {
    getIdleTimeSeconds: () => readIdleTime(powerMonitor),
    getIdleState: (thresholdSeconds) =>
      normalizeIdleState(
        powerMonitor.getSystemIdleState(Math.max(1, thresholdSeconds)),
      ),
    subscribe: (listener) => {
      for (const event of POWER_EVENTS) {
        powerMonitor.on(event, listener);
      }
      return () => {
        const remove = powerMonitor.off ?? powerMonitor.removeListener;
        if (!remove) {
          return;
        }
        for (const event of POWER_EVENTS) {
          remove.call(powerMonitor, event, listener);
        }
      };
    },
  };
}

export function tryCreateElectronIdleSource(): IdleSource | undefined {
  const powerMonitor = loadPowerMonitor();
  if (
    typeof powerMonitor?.getSystemIdleTime !== "function" ||
    typeof powerMonitor.getSystemIdleState !== "function" ||
    typeof powerMonitor.on !== "function"
  ) {
    return undefined;
  }
  return createElectronIdleSource(powerMonitor);
}

function loadPowerMonitor(): PowerMonitorLike | undefined {
  if (typeof (process.versions as { electron?: unknown }).electron !== "string") {
    return undefined;
  }
  try {
    const electron = nodeRequire("electron") as {
      powerMonitor?: PowerMonitorLike;
    };
    return electron.powerMonitor;
  } catch {
    return undefined;
  }
}

function readIdleTime(powerMonitor: PowerMonitorLike): number {
  const value = powerMonitor.getSystemIdleTime();
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeIdleState(value: string): IdleState {
  if (
    value === "active" ||
    value === "idle" ||
    value === "locked" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}
