const { mkdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = path.join(root, "server");
const temp = path.join(root, ".tmp");
mkdirSync(temp, { recursive: true });

const tsxBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

const result = spawnSync(tsxBin, process.argv.slice(2), {
  cwd: server,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    TMP: temp,
    TEMP: temp,
    TMPDIR: temp
  }
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
