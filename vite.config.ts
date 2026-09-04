import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
  "electron",
];

export default defineConfig({
  root: process.cwd(),
  resolve: {
    conditions: ["node", "module", "import", "default"],
  },
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "node20",
    rollupOptions: {
      external: [...nodeExternals, /^@smart-renderers\//],
    },
  },
});
