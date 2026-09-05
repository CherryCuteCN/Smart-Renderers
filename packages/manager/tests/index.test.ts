import { expect, test } from "vitest";
import * as manager from "../src/index";

test("module loads", () => {
  expect(manager).toBeTypeOf("object");
});

test("exports the manager contract", () => {
  expect(manager.createManager).toBeTypeOf("function");
  expect(manager.createMemoryActionPort).toBeTypeOf("function");
  expect(manager.createElectronActionPort).toBeTypeOf("function");
  expect(manager.createContentsHandle).toBeTypeOf("function");
  expect(manager.DEFAULT_EXPIRED_ACTION).toBe("hibernate");
});
