import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  getSandboxOrNull,
  sandboxIsTerminated,
  shellQuote,
} from "./sandbox.mjs";
import { runSync } from "./process.mjs";
import { PluginError } from "./result.mjs";

export const MAX_PATCH_BYTES = 1024 * 1024;

async function exportRemotePatch(mapping, options = {}) {
  const getSandbox = options.getSandbox ?? getSandboxOrNull;
  const sandbox = await getSandbox(
    mapping.sandboxName,
    mapping.blaxelWorkspace,
  );
  if (!sandbox || sandboxIsTerminated(sandbox)) {
    throw new PluginError(
      "sandbox_not_found",
      `Sandbox ${mapping.sandboxName} no longer exists.`,
    );
  }
  if (!mapping.lastAppliedExportCommit) {
    throw new PluginError(
      "missing_export_baseline",
      "The mapping has no remote export baseline.",
    );
  }
  const patchPath = `/tmp/herdr-${mapping.id}-${randomUUID()}-export.patch`;
  const command = [
    "set -eu",
    `cd ${shellQuote(mapping.remoteRoot)}`,
    "git add -A",
    `git commit -q --allow-empty -m ${shellQuote(`Herdr export ${new Date().toISOString()}`)}`,
    "next=$(git rev-parse HEAD)",
    `git diff --binary ${shellQuote(mapping.lastAppliedExportCommit)} "$next" > ${shellQuote(patchPath)}`,
    `printf '%s\\n' "$next"; wc -c < ${shellQuote(patchPath)}`,
  ].join("\n");
  try {
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
    const metadata = String(snapshot.stdout ?? "")
      .trim()
      .match(/^([0-9a-f]{40})\s+(\d+)$/);
    if (!metadata) {
      throw new PluginError(
        "remote_export_failed",
        "Remote patch export returned invalid commit or size metadata.",
      );
    }
    const [, nextCommit, size] = metadata;
    if (Number(size) > MAX_PATCH_BYTES)
      throw new PluginError(
        "patch_too_large",
        "The remote patch exceeds the 1 MiB review limit. Reduce the remote changes before retrying; no local files were changed.",
      );
    const blob = await sandbox.fs.readBinary(patchPath);
    if (blob.size !== Number(size))
      throw new PluginError(
        "patch_changed",
        "The remote patch changed during export. Retry Apply to review a fresh patch.",
      );
    const patch = Buffer.from(await blob.arrayBuffer());
    return { nextCommit, patch };
  } finally {
    await sandbox.fs.rm(patchPath).catch(() => {});
  }
}

function checkPatch(localPatch, mapping, runCommand) {
  return runCommand("git", ["apply", "--check", "--binary", localPatch], {
    cwd: mapping.localRoot,
    check: false,
  });
}

function reverseCheckPatch(localPatch, mapping, runCommand) {
  return runCommand(
    "git",
    ["apply", "--reverse", "--check", "--binary", localPatch],
    { cwd: mapping.localRoot, check: false },
  );
}

function conflictError(check) {
  return new PluginError(
    "patch_conflict",
    `git apply --check failed: ${check.stderr.trim() || "unknown conflict"}`,
  );
}

export async function preparePatch(mapping, options = {}) {
  const runCommand = options.runCommand ?? runSync;
  const exported = await exportRemotePatch(mapping, options);
  if (exported.patch.length === 0) {
    return {
      status: "no_change",
      nextCommit: exported.nextCommit,
      bytes: 0,
      summary: "No remote changes.",
      cleanup() {},
    };
  }
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "herdr-blaxel-patch-"),
  );
  const localPatch = path.join(temporaryDirectory, "changes.patch");
  fs.writeFileSync(localPatch, exported.patch, { mode: 0o600 });
  const cleanup = () =>
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  try {
    const check = checkPatch(localPatch, mapping, runCommand);
    if (check.status !== 0) {
      const reverse = reverseCheckPatch(localPatch, mapping, runCommand);
      if (reverse.status === 0) {
        return {
          status: "already_applied",
          nextCommit: exported.nextCommit,
          bytes: exported.patch.length,
          summary: "These remote changes are already present locally.",
          cleanup,
        };
      }
      throw conflictError(check);
    }
    const summaryResult = runCommand(
      "git",
      ["apply", "--stat", "--summary", "--binary", localPatch],
      { cwd: mapping.localRoot, check: false },
    );
    return {
      status: "ready",
      nextCommit: exported.nextCommit,
      bytes: exported.patch.length,
      summary:
        `${summaryResult.stdout}${summaryResult.stderr}`.trim() ||
        `${exported.patch.length} byte binary Git patch`,
      localPatch,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function applyPreparedPatch(prepared, mapping, options = {}) {
  if (prepared.status !== "ready") return prepared;
  const runCommand = options.runCommand ?? runSync;
  const check = checkPatch(prepared.localPatch, mapping, runCommand);
  if (check.status !== 0) {
    const reverse = reverseCheckPatch(prepared.localPatch, mapping, runCommand);
    if (reverse.status === 0) return { ...prepared, status: "already_applied" };
    throw conflictError(check);
  }
  runCommand("git", ["apply", "--binary", prepared.localPatch], {
    cwd: mapping.localRoot,
  });
  return { ...prepared, status: "applied" };
}

export async function exportAndApplyPatch(mapping, options = {}) {
  const prepared = await preparePatch(mapping, options);
  try {
    return applyPreparedPatch(prepared, mapping, options);
  } finally {
    prepared.cleanup();
  }
}
