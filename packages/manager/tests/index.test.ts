import { expect, test } from "vitest";
import * as manager from "../src/index";

test("module loads", () => {
  expect(manager).toBeTypeOf("object");
});

test("exports the manager contract", () => {
  expect(manager.createManager).toBeTypeOf("function");
});
