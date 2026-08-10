import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getSandboxOrNull,
  sandboxIsTerminated,
  shellQuote,
} from "./sandbox.mjs";
import { runSync } from "./process.mjs";
import { PluginError } from "./result.mjs";

export async function exportAndApplyPatch(mapping, options = {}) {
  const getSandbox = options.getSandbox ?? getSandboxOrNull;
  const runCommand = options.runCommand ?? runSync;
  const sandbox = await getSandbox(
    mapping.sandboxName,
    mapping.blaxelWorkspace,
  );
  if (!sandbox || sandboxIsTerminated(sandbox))
    throw new PluginError(
      "sandbox_not_found",
      `Sandbox ${mapping.sandboxName} no longer exists.`,
    );
  if (!mapping.lastAppliedExportCommit) {
    throw new PluginError(
      "missing_export_baseline",
      "The mapping has no remote export baseline.",
    );
  }
  const patchPath = `/tmp/herdr-${mapping.id}-export.patch`;
  const command = [
    "set -eu",
    `cd ${shellQuote(mapping.remoteRoot)}`,
    "git add -A",
    `git commit -q --allow-empty -m ${shellQuote(`Herdr export ${new Date().toISOString()}`)}`,
    "next=$(git rev-parse HEAD)",
    `git diff --binary ${shellQuote(mapping.lastAppliedExportCommit)} "$next" > ${shellQuote(patchPath)}`,
    "printf '%s' \"$next\"",
  ].join("\n");
  const snapshot = await sandbox.process.exec({
    name: `herdr-export-${mapping.id.slice(0, 8)}-${Date.now()}`,
    command,
    workingDir: mapping.remoteRoot,
    waitForCompletion: true,
    timeout: 60,
  });
  const exitCode = snapshot.exitCode ?? snapshot.exit_code;
  if (
    String(snapshot.status).toLowerCase() === "failed" ||
    (Number.isInteger(exitCode) && exitCode !== 0)
  ) {
    throw new PluginError(
      "remote_export_failed",
      snapshot.stderr || snapshot.logs || "Remote patch export failed.",
    );
  }
  const nextCommit = String(snapshot.stdout ?? "").trim();
  if (!/^[0-9a-f]{40}$/.test(nextCommit)) {
    throw new PluginError(
      "remote_export_failed",
      "Remote patch export returned no commit.",
    );
  }
  const blob = await sandbox.fs.readBinary(patchPath);
  const patch = Buffer.from(await blob.arrayBuffer());
  if (patch.length === 0) {
    return { status: "no_change", nextCommit, bytes: 0 };
  }
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-blaxel-patch-"),
  );
  const localPatch = path.join(temporaryDirectory, "changes.patch");
  try {
    fs.writeFileSync(localPatch, patch, { mode: 0o600 });
    const check = runCommand(
      "git",
      ["apply", "--check", "--binary", localPatch],
      {
        cwd: mapping.localRoot,
        check: false,
      },
    );
    if (check.status !== 0) {
      const reverse = runCommand(
        "git",
        ["apply", "--reverse", "--check", "--binary", localPatch],
        {
          cwd: mapping.localRoot,
          check: false,
        },
      );
      if (reverse.status === 0) {
        return { status: "already_applied", nextCommit, bytes: patch.length };
      }
      throw new PluginError(
        "patch_conflict",
        `git apply --check failed: ${check.stderr.trim() || "unknown conflict"}`,
      );
    }
    runCommand("git", ["apply", "--binary", localPatch], {
      cwd: mapping.localRoot,
    });
    return { status: "applied", nextCommit, bytes: patch.length };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
