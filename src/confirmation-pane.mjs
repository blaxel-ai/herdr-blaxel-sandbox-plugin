#!/usr/bin/env node
import readline from "node:readline";

import { getAdapter } from "./adapters.mjs";
import { loadConfig } from "./config.mjs";
import { approvalFingerprint, buildUploadManifest } from "./manifest.mjs";
import { PluginError, emitFailure, emitResult } from "./result.mjs";
import {
  deleteSandbox,
  provisionSandbox,
  resolveBlaxelWorkspace,
} from "./sandbox.mjs";
import { pendingStartMatches, readState, updateState } from "./state.mjs";

const action = process.env.BLAXEL_HERDR_DESTRUCTIVE_ACTION || "unknown";

function askForDelete(mapping) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PluginError(
      "interactive_confirmation_required",
      "Deletion confirmation requires an interactive terminal.",
    );
  }
  process.stdout.write(
    [
      "Permanent Blaxel sandbox deletion",
      "",
      `Sandbox: ${mapping.sandboxName}`,
      `Agent: ${mapping.agentKind}`,
      `Local worktree: ${mapping.localRoot}`,
      "",
      action === "replace"
        ? "This deletes the current sandbox and builds a replacement from the approved upload."
        : "This deletes the sandbox and removes its local mapping.",
      "Type DELETE within 60 seconds to continue: ",
    ].join("\n"),
  );
  return new Promise((resolve) => {
    const terminal = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const timer = setTimeout(() => {
      terminal.close();
      resolve(false);
    }, 60_000);
    terminal.once("line", (line) => {
      clearTimeout(timer);
      terminal.close();
      resolve(line.trim() === "DELETE");
    });
  });
}

async function patchMapping(mappingId, patch) {
  await updateState((state) => {
    const mapping = state.mappings[mappingId];
    if (!mapping)
      throw new PluginError(
        "mapping_not_found",
        `Mapping ${mappingId} no longer exists.`,
      );
    state.mappings[mappingId] = {
      ...mapping,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
}

async function deleteMapping(mapping) {
  await patchMapping(mapping.id, { lifecycleState: "deleting" });
  await deleteSandbox(mapping);
  await updateState((state) => {
    delete state.mappings[mapping.id];
    delete state.pendingStarts[`replace:${mapping.id}`];
    return state;
  });
  emitResult("delete-sandbox", "deleted", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

async function replaceMapping(mapping) {
  const config = loadConfig();
  const adapter = getAdapter(mapping.agentKind);
  const manifest = buildUploadManifest(mapping.localRoot, config);
  const expectedDigest = process.env.BLAXEL_HERDR_MANIFEST_DIGEST;
  const expectedFingerprint = process.env.BLAXEL_HERDR_PROVISIONING_FINGERPRINT;
  const blaxelWorkspace =
    mapping.blaxelWorkspace ?? resolveBlaxelWorkspace(config);
  const currentFingerprint = approvalFingerprint({
    config,
    adapter,
    workspace: blaxelWorkspace,
  });
  const pending = readState().pendingStarts[`replace:${mapping.id}`];
  if (
    !expectedDigest ||
    !expectedFingerprint ||
    manifest.digest !== expectedDigest ||
    currentFingerprint !== expectedFingerprint ||
    !pendingStartMatches(pending, manifest.digest, currentFingerprint)
  ) {
    throw new PluginError(
      "replacement_approval_changed",
      "The replacement upload changed or expired. Run Replace again.",
    );
  }
  await patchMapping(mapping.id, { lifecycleState: "deleting" });
  await deleteSandbox(mapping);
  await patchMapping(mapping.id, {
    lifecycleState: "creating",
    remotePaneId: null,
    blaxelWorkspace,
    uploadManifestDigest: manifest.digest,
    lastAppliedExportCommit: null,
    lastError: null,
  });
  try {
    const refreshed = readState().mappings[mapping.id];
    const provisioned = await provisionSandbox({
      mapping: refreshed,
      manifest,
      config,
      adapter,
      onLifecycle: (lifecycleState) =>
        patchMapping(mapping.id, { lifecycleState }),
    });
    await patchMapping(mapping.id, {
      lifecycleState: "ready",
      lastAppliedExportCommit: provisioned.baselineCommit,
      installedVersion: provisioned.installedVersion,
      capabilities: provisioned.capabilities,
    });
    await updateState((state) => {
      delete state.pendingStarts[`replace:${mapping.id}`];
      return state;
    });
    emitResult("replace-sandbox", "ready", {
      mappingId: mapping.id,
      sandboxName: mapping.sandboxName,
      manifestDigest: manifest.digest,
      nextAction: "Reconnect to Blaxel agent",
    });
  } catch (error) {
    await patchMapping(mapping.id, {
      lifecycleState: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
}

try {
  if (!new Set(["delete", "replace"]).has(action)) {
    throw new PluginError(
      "unknown_destructive_action",
      `Unsupported destructive action: ${action}.`,
    );
  }
  const mappingId = process.env.BLAXEL_HERDR_MAPPING_ID;
  const mapping = mappingId ? readState().mappings[mappingId] : null;
  if (!mapping)
    throw new PluginError(
      "mapping_not_found",
      "The requested mapping no longer exists.",
    );
  if (!(await askForDelete(mapping))) {
    emitResult(`${action}-sandbox`, "canceled", {
      mappingId: mapping.id,
      sandboxName: mapping.sandboxName,
    });
  } else if (action === "delete") {
    await deleteMapping(mapping);
  } else {
    await replaceMapping(mapping);
  }
} catch (error) {
  emitFailure(`${action}-sandbox`, error);
  process.exitCode = 1;
}
