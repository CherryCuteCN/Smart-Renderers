import { expect, test } from "vitest";
import * as core from "../src/index";

test("module loads", () => {
  expect(core).toBeTypeOf("object");
});

test("exports the runtime contract", () => {
  expect(core.createRuntime).toBeTypeOf("function");
  expect(core.SNAPSHOT_SCHEMA).toBe("smart-renderers/snapshot/1");
  expect(core.DEFAULT_COUNTDOWN_MS).toBe(15 * 60 * 1000);
});
