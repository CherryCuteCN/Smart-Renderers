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
    conditions: ["node", "module", "import", "default"],
  },
});
