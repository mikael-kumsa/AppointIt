const { mkdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = path.join(root, "server");
const temp = path.join(root, ".tmp");
mkdirSync(temp, { recursive: true });

const prismaBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma"
);

const result = spawnSync(prismaBin, process.argv.slice(2), {
  cwd: server,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    TMP: temp,
    TEMP: temp,
    TMPDIR: temp,
    PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: "1"
  }
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
