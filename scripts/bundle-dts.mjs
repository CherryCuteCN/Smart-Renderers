import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const internals = {
  "@smart-renderers/core": path.join(dist, "internal", "core", "index.d.ts"),
  "@smart-renderers/manager": path.join(dist, "internal", "manager", "index.d.ts"),
};

function copyDts(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  cpSync(fromDir, toDir, {
    recursive: true,
    filter: (src) => {
      if (statSync(src).isDirectory()) {
        return true;
      }
      return src.endsWith(".d.ts") || src.endsWith(".d.ts.map");
    },
  });
}

function walkDts(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDts(fullPath, files);
      continue;
    }
    if (entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function toSpecifier(fromFile, targetFile) {
  let relative = path.relative(path.dirname(fromFile), targetFile).replaceAll("\\", "/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative.replace(/\.d\.ts$/, ".js");
}

function rewriteSpecifiers(source, filePath) {
  return source.replaceAll(
    /(["'])(@smart-renderers\/(?:core|manager))\1/g,
    (_match, quote, spec) => `${quote}${toSpecifier(filePath, internals[spec])}${quote}`,
  );
}

copyDts(path.join(root, "packages/core/dist"), path.join(dist, "internal", "core"));
copyDts(path.join(root, "packages/manager/dist"), path.join(dist, "internal", "manager"));

for (const filePath of walkDts(dist)) {
  writeFileSync(filePath, rewriteSpecifiers(readFileSync(filePath, "utf8"), filePath));
}

const bundled = readFileSync(path.join(dist, "index.js"), "utf8");
if (/["']@smart-renderers\//.test(bundled)) {
  throw new Error("dist/index.js still imports workspace packages");
}
