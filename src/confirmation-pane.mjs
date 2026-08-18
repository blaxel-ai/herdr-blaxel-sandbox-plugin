#!/usr/bin/env node
import readline from "node:readline";

import { getAdapter } from "./adapters.mjs";
import { loadConfig } from "./config.mjs";
import { parsePluginContext } from "./context.mjs";
import { closePluginPane, openPluginPane } from "./herdr.mjs";
import {
  buildUploadManifest,
  formatManifest,
  startSnapshotFingerprint,
} from "./manifest.mjs";
import { patchMapping } from "./mappings.mjs";
import { PluginError, errorMessage } from "./result.mjs";
import {
  deleteSandbox,
  provisionSandbox,
  resolveBlaxelWorkspace,
} from "./sandbox.mjs";
import { startTarget } from "./start.mjs";
import { readState, updateState } from "./state.mjs";

const action = process.env.BLAXEL_HERDR_DESTRUCTIVE_ACTION || "unknown";

function sourceContext() {
  return parsePluginContext(
    process.env.BLAXEL_HERDR_SOURCE_CONTEXT_JSON ??
      process.env.HERDR_PLUGIN_CONTEXT_JSON,
  );
}

function replacementPreview(mapping) {
  const config = loadConfig();
  const adapter = getAdapter(mapping.agentKind);
  const workspace = mapping.blaxelWorkspace ?? resolveBlaxelWorkspace(config);
  const manifest = buildUploadManifest(mapping.localRoot, config);
  return {
    config,
    adapter,
    workspace,
    manifest,
    fingerprint: startSnapshotFingerprint({ config, adapter, workspace }),
    target: startTarget(config, adapter, workspace, mapping.sandboxName),
  };
}

function askForDelete(mapping, preview) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PluginError(
      "interactive_confirmation_required",
      "Deletion confirmation requires an interactive terminal.",
    );
  }
  process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write(
    action === "replace"
      ? "Replace Blaxel Sandbox\n\n"
      : "Permanently delete Blaxel Sandbox\n\n",
  );
  if (preview) {
    process.stdout.write(
      `${formatManifest(preview.manifest, {
        target: preview.target,
        approvalPrompt: false,
      })}\n\n`,
    );
  } else {
    process.stdout.write(
      `Sandbox: ${mapping.sandboxName}\nAgent: ${mapping.agentKind}\nLocal worktree: ${mapping.localRoot}\n\n`,
    );
  }
  process.stdout.write(
    action === "replace"
      ? "This permanently deletes the current Sandbox, then creates the shown replacement.\n"
      : "This permanently deletes the Sandbox and removes its local mapping.\n",
  );
  process.stdout.write("Type DELETE within 60 seconds to continue: ");
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

async function deleteMapping(mapping) {
  await patchMapping(mapping.id, { lifecycleState: "deleting" });
  await deleteSandbox(mapping);
  await updateState((state) => {
    delete state.mappings[mapping.id];
    return state;
  });
  if (mapping.remotePaneId) {
    closePluginPane(mapping.remotePaneId, { check: false });
  }
  process.stdout.write(`\nDeleted ${mapping.sandboxName}.\n`);
}

function revalidateReplacement(mapping, preview) {
  const fresh = replacementPreview(mapping);
  if (
    fresh.manifest.digest !== preview.manifest.digest ||
    fresh.fingerprint !== preview.fingerprint
  ) {
    throw new PluginError(
      "replacement_snapshot_changed",
      "The replacement target, configuration, or upload changed. Run Replace again to review it.",
    );
  }
  return fresh;
}

async function replaceMapping(mapping, preview) {
  const fresh = revalidateReplacement(mapping, preview);
  process.stdout.write("\nDeleting the current Sandbox...\n");
  await patchMapping(mapping.id, { lifecycleState: "deleting" });
  await deleteSandbox(mapping);
  if (mapping.remotePaneId) {
    closePluginPane(mapping.remotePaneId, { check: false });
  }
  await patchMapping(mapping.id, {
    lifecycleState: "creating",
    remotePaneId: null,
    blaxelWorkspace: fresh.workspace,
    uploadManifestDigest: fresh.manifest.digest,
    lastAppliedExportCommit: null,
    lastError: null,
  });
  try {
    const refreshed = readState().mappings[mapping.id];
    const labels = {
      creating: "Creating replacement Sandbox",
      uploading: "Uploading filtered files",
      preparing: `Installing and preparing ${fresh.adapter.title}`,
    };
    const provisioned = await provisionSandbox({
      mapping: refreshed,
      manifest: fresh.manifest,
      config: fresh.config,
      adapter: fresh.adapter,
      onLifecycle: async (lifecycleState) => {
        await patchMapping(mapping.id, { lifecycleState });
        process.stdout.write(`  ${labels[lifecycleState]}...\n`);
      },
    });
    const ready = await patchMapping(mapping.id, {
      lifecycleState: "ready",
      lastAppliedExportCommit: provisioned.baselineCommit,
      installedVersion: provisioned.installedVersion,
      capabilities: provisioned.capabilities,
      lastError: null,
    });
    process.stdout.write(`\nReplacement ready: ${ready.sandboxName}\n`);
    openPluginPane("agent", sourceContext(), {
      placement: "split",
      targetPaneId: ready.sourcePaneId,
      env: {
        BLAXEL_HERDR_MAPPING_ID: ready.id,
        HERDR_AGENT: fresh.adapter.herdrDetectionKind,
        BL_WORKSPACE: ready.blaxelWorkspace,
      },
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
  if (!mapping) {
    throw new PluginError(
      "mapping_not_found",
      "The requested mapping no longer exists.",
    );
  }
  const preview = action === "replace" ? replacementPreview(mapping) : null;
  if (!(await askForDelete(mapping, preview))) {
    process.stdout.write("\nCanceled. Nothing was deleted.\n");
  } else if (action === "delete") {
    await deleteMapping(mapping);
  } else {
    await replaceMapping(mapping, preview);
  }
} catch (error) {
  process.stdout.write(`\n${errorMessage(error)}\n`);
  process.exitCode = 1;
}
