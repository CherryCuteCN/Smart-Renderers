import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const electron = createRequire(import.meta.url)("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronArgs = [];
if (env.CI) {
  electronArgs.push("--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");
}
electronArgs.push(join(root, "..", "dist", "e2e.js"));

const child = spawn(electron, electronArgs, {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
