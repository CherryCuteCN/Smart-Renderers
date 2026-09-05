import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const isRootBuild = path.resolve(process.cwd()) === path.resolve(repoRoot);

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
      external: isRootBuild
        ? nodeExternals
        : [...nodeExternals, /^@smart-renderers\//],
    },
  },
});
