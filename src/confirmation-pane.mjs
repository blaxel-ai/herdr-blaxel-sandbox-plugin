#!/usr/bin/env node
import { isMain, runPane } from "./terminal-ui.mjs";

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
import { PluginError } from "./result.mjs";
import {
  deleteSandbox,
  provisionSandbox,
  resolveBlaxelWorkspace,
} from "./sandbox.mjs";
import { startTarget } from "./start.mjs";
import { readState, updateState } from "./state.mjs";

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

async function askForDelete(action, mapping, preview, ui) {
  ui.write(
    `Sandbox: ${mapping.sandboxName}\nWorkspace: ${mapping.blaxelWorkspace}\nWorktree: ${mapping.localRoot}\n`,
  );
  if (preview)
    ui.write(
      formatManifest(preview.manifest, {
        target: preview.target,
        approvalPrompt: false,
      }),
    );
  ui.write(
    action === "replace"
      ? "This permanently deletes the current Sandbox, then creates the shown replacement."
      : "This permanently deletes the Sandbox and its remote files.",
  );
  return (
    (
      await ui.ask("Type DELETE within 60 seconds:", { timeoutMs: 60_000 })
    ).trim() === "DELETE"
  );
}

async function deleteMapping(mapping, ui) {
  await patchMapping(mapping.id, { lifecycleState: "deleting" });
  await deleteSandbox(mapping);
  await updateState((state) => {
    delete state.mappings[mapping.id];
    return state;
  });
  if (mapping.remotePaneId) {
    closePluginPane(mapping.remotePaneId, { check: false });
  }
  ui.write(`\nDeleted ${mapping.sandboxName}.\n`);
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

async function replaceMapping(mapping, preview, ui, context) {
  const fresh = revalidateReplacement(mapping, preview);
  ui.write("\nDeleting the current Sandbox...\n");
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
        ui.write(`  ${labels[lifecycleState]}...\n`);
      },
    });
    const ready = await patchMapping(mapping.id, {
      lifecycleState: "ready",
      lastAppliedExportCommit: provisioned.baselineCommit,
      installedVersion: provisioned.installedVersion,
      capabilities: provisioned.capabilities,
      lastError: null,
    });
    ui.write(`\nReplacement ready: ${ready.sandboxName}\n`);
    openPluginPane("agent", context, {
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

export async function runDestructive(action, mapping, ui, context) {
  if (!["delete", "replace"].includes(action))
    throw new PluginError(
      "unknown_destructive_action",
      `Unsupported action: ${action}.`,
    );
  const preview = action === "replace" ? replacementPreview(mapping) : null;
  if (!(await askForDelete(action, mapping, preview, ui))) return;
  const current = readState().mappings[mapping.id];
  if (!current || current.updatedAt !== mapping.updatedAt)
    throw new PluginError(
      "mapping_changed",
      "The Sandbox changed while this dialog was open. Review it again.",
    );
  try {
    if (action === "delete") await deleteMapping(mapping, ui);
    else await replaceMapping(mapping, preview, ui, context);
  } catch (error) {
    await patchMapping(mapping.id, {
      lifecycleState: "failed",
      lastError: error.message,
    }).catch(() => {});
    throw error;
  }
}

if (isMain(import.meta.url))
  await runPane("Confirm Sandbox change", (ui) => {
    const mapping = readState().mappings[process.env.BLAXEL_HERDR_MAPPING_ID];
    if (!mapping)
      throw new PluginError(
        "mapping_not_found",
        "The requested mapping no longer exists.",
      );
    return runDestructive(
      process.env.BLAXEL_HERDR_DESTRUCTIVE_ACTION,
      mapping,
      ui,
      sourceContext(),
    );
  });
