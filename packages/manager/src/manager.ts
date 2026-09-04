import type { CoreEvent } from "@smart-renderers/core";
import type { Manager, ManagerOptions, Operator } from "./types";

export function createManager(options: ManagerOptions): Manager {
  const operators = new Map<string, Operator>();
  let disposed = false;

  for (const operator of options.operators ?? []) {
    addOperator(operators, operator);
  }

  const unsubscribe = options.runtime.subscribe((event) => {
    if (disposed) {
      return;
    }
    dispatch(event);
  });

  function dispatch(event: CoreEvent): void {
    for (const operator of [...operators.values()]) {
      if (!operator.interestedIn.includes(event.type)) {
        continue;
      }
      try {
        void Promise.resolve(operator.handle(event)).catch((error: unknown) => {
          options.onOperatorError?.(error, operator, event);
        });
      } catch (error) {
        options.onOperatorError?.(error, operator, event);
      }
    }
  }

  function assertOpen(): void {
    if (disposed) {
      throw new Error("manager is disposed");
    }
  }

  return {
    register(operator) {
      assertOpen();
      addOperator(operators, operator);
    },
    unregister(name) {
      assertOpen();
      operators.delete(name);
    },
    getSnapshot() {
      assertOpen();
      return options.runtime.getSnapshot();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe();
      operators.clear();
    },
  };
}

function addOperator(
  operators: Map<string, Operator>,
  operator: Operator,
): void {
  if (operators.has(operator.name)) {
    throw new Error(`operator already registered: ${operator.name}`);
  }
  operators.set(operator.name, operator);
}
