import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runSync } from "../src/process.mjs";

export function temporaryDirectory(prefix = "herdr-blaxel-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeGitRepository() {
  const root = temporaryDirectory();
  runSync("git", ["init", "-q"], { cwd: root });
  runSync("git", ["config", "user.name", "Test User"], { cwd: root });
  runSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  return root;
}

export function write(root, relativePath, content, mode) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
  return file;
}

export function remove(root) {
  fs.rmSync(root, { recursive: true, force: true });
}
