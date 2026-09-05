import type { IdleSource } from "smart-renderers";

export type ControllableIdle = {
  source: IdleSource;
  setSystemIdle(idle: boolean): void;
  setIdleTimeSeconds(seconds: number): void;
  isSystemIdle(): boolean;
};

export function createControllableIdleSource(): ControllableIdle {
  let systemIdle = false;
  let idleSince: number | undefined;
  const listeners = new Set<() => void>();

  function idleSeconds(): number {
    if (!systemIdle || idleSince === undefined) {
      return 0;
    }
    return Math.max(0, Math.floor((Date.now() - idleSince) / 1000));
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    source: {
      getIdleTimeSeconds: idleSeconds,
      getIdleState(thresholdSeconds) {
        if (!systemIdle) {
          return "active";
        }
        return idleSeconds() >= thresholdSeconds ? "idle" : "active";
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    setSystemIdle(idle) {
      if (systemIdle === idle) {
        return;
      }
      systemIdle = idle;
      idleSince = idle ? Date.now() : undefined;
      notify();
    },
    setIdleTimeSeconds(seconds) {
      const next = Math.max(0, seconds);
      systemIdle = next > 0;
      idleSince = next > 0 ? Date.now() - next * 1000 : undefined;
      notify();
    },
    isSystemIdle() {
      return systemIdle;
    },
  };
}
