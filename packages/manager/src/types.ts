import type { CoreEvent, RendererSnapshot, Runtime } from "@smart-renderers/core";

export type Operator = {
  readonly name: string;
  readonly interestedIn: readonly CoreEvent["type"][];
  handle(event: CoreEvent): Promise<void> | void;
};

export type ManagerOptions = {
  runtime: Runtime;
  operators?: readonly Operator[];
  onOperatorError?: (
    error: unknown,
    operator: Operator,
    event: CoreEvent,
  ) => void;
};

export type Manager = {
  register(operator: Operator): void;
  unregister(name: string): void;
  getSnapshot(): RendererSnapshot;
  dispose(): void;
};
