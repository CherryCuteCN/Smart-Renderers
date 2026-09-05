import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: process.cwd(),
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@smart-renderers/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@smart-renderers/manager": fileURLToPath(
        new URL("./packages/manager/src/index.ts", import.meta.url),
      ),
    },
    conditions: ["node", "module", "import", "default"],
  },
});
