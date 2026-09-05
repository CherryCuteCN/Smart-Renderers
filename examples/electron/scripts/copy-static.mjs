import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "..", "src");
const dest = join(root, "..", "dist");

mkdirSync(dest, { recursive: true });
copyFileSync(join(src, "index.html"), join(dest, "index.html"));
