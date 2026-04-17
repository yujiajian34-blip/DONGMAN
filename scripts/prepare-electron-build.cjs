const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const standaloneNextRoot = path.join(standaloneRoot, ".next");
const sourceStaticDir = path.join(projectRoot, ".next", "static");
const targetStaticDir = path.join(standaloneNextRoot, "static");
const sourcePublicDir = path.join(projectRoot, "public");
const targetPublicDir = path.join(standaloneRoot, "public");

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  ensureDirectory(path.dirname(targetDir));
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

if (!fs.existsSync(standaloneRoot)) {
  throw new Error("Missing .next/standalone. Run `next build` before packaging.");
}

ensureDirectory(standaloneNextRoot);
copyDirectory(sourceStaticDir, targetStaticDir);
copyDirectory(sourcePublicDir, targetPublicDir);

console.log("Prepared standalone output for Electron packaging.");
