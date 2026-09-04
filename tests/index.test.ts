import { expect, test } from "vitest";
import * as smartRenderers from "../src/index";

test("module loads", () => {
  expect(smartRenderers).toBeTypeOf("object");
});
