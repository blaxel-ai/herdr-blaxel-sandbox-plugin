import crypto from "node:crypto";

import { getAdapter } from "./adapters.mjs";
import { loadConfig } from "./config.mjs";
import { parsePluginContext, resolveGitContext } from "./context.mjs";
import { closePluginPane, openPluginPane } from "./herdr.mjs";
import {
  approvalFingerprint,
  buildUploadManifest,
  formatManifest,
} from "./manifest.mjs";
import { exportAndApplyPatch } from "./patch.mjs";
import { PluginError, emitResult } from "./result.mjs";
import {
  captureAgentOutput,
  provisionSandbox,
  resolveBlaxelWorkspace,
  sandboxInfo,
  sandboxNameFor,
  stopAgent,
} from "./sandbox.mjs";
import {
  pendingStartKey,
  pendingStartMatches,
  readState,
  requireMapping,
  updateState,
} from "./state.mjs";

function nowIso() {
  return new Date().toISOString();
}

async function patchMapping(mappingId, patch) {
  let updated;
  await updateState((state) => {
    const mapping = state.mappings[mappingId];
    if (!mapping)
      throw new PluginError(
        "mapping_not_found",
        `Mapping ${mappingId} no longer exists.`,
      );
    updated = {
      ...mapping,
      ...patch,
      updatedAt: nowIso(),
    };
    state.mappings[mappingId] = updated;
    return state;
  });
  return updated;
}

function requireNoExistingMapping(state, gitContext, agentKind) {
  const existing = Object.values(state.mappings).find(
    (mapping) =>
      mapping.localRoot === gitContext.root &&
      mapping.agentKind === agentKind &&
      mapping.lifecycleState !== "deleted",
  );
  if (existing) {
    throw new PluginError(
      "mapping_already_exists",
      `This ${agentKind} worktree already maps to ${existing.sandboxName}. Use Reconnect or Replace.`,
      {
        details: { mappingId: existing.id, sandboxName: existing.sandboxName },
      },
    );
  }
}

function approvalTarget(config, adapter, workspace, sandboxName) {
  return {
    sandboxName,
    workspace,
    agent: `${adapter.title} ${adapter.expectedVersion}`,
    image: config.image,
    region: config.region,
    memory: config.memory,
    remoteRoot: config.remoteRoot,
    idleDelete: config.idleDelete,
    previewPorts: config.previewPorts,
    publicPreviews: config.publicPreviews,
  };
}

function printManifest(manifest, target, actionTitle, approvalSeconds) {
  process.stdout.write(
    `${formatManifest(manifest, {
      target,
      actionTitle,
      approvalSeconds,
    })}\n`,
  );
}

function openBlaxelLogin(context, workspace, openPane = openPluginPane) {
  openPane("blaxel-login", context, {
    placement: "popup",
    env: workspace ? { BLAXEL_HERDR_LOGIN_WORKSPACE: workspace } : {},
  });
}

export async function connectBlaxel(context, options = {}) {
  const config = loadConfig();
  openBlaxelLogin(
    context,
    config.workspace,
    options.openPane ?? openPluginPane,
  );
  return emitResult("connect-blaxel", "opened", { pane: "blaxel-login" });
}

export async function startAgent(context, options = {}) {
  const config = loadConfig();
  const adapter = getAdapter(config.agent);
  const resolveWorkspace = options.resolveWorkspace ?? resolveBlaxelWorkspace;
  let blaxelWorkspace;
  try {
    blaxelWorkspace = resolveWorkspace(config);
  } catch (error) {
    if (
      error instanceof PluginError &&
      ["blaxel_login_required", "blaxel_workspace_unavailable"].includes(
        error.code,
      )
    ) {
      openBlaxelLogin(
        context,
        config.workspace,
        options.openPane ?? openPluginPane,
      );
      return emitResult("start-agent", "needs_blaxel_login", {
        pane: "blaxel-login",
        ...(config.workspace ? { workspace: config.workspace } : {}),
      });
    }
    throw error;
  }
  const provisioningFingerprint = approvalFingerprint({
    config,
    adapter,
    workspace: blaxelWorkspace,
  });
  const gitContext = resolveGitContext(context);
  const sandboxName = sandboxNameFor({
    prefix: config.sandboxNamePrefix,
    agentKind: adapter.kind,
    localRoot: gitContext.root,
    sourcePaneId: gitContext.sourcePaneId,
  });
  const target = approvalTarget(config, adapter, blaxelWorkspace, sandboxName);
  const manifest = buildUploadManifest(gitContext.root, config);
  const key = pendingStartKey(gitContext.root, adapter.kind);
  const current = readState();
  requireNoExistingMapping(current, gitContext, adapter.kind);
  const pending = current.pendingStarts[key];
  if (!pendingStartMatches(pending, manifest.digest, provisioningFingerprint)) {
    await updateState((state) => {
      requireNoExistingMapping(state, gitContext, adapter.kind);
      state.pendingStarts[key] = {
        operation: "start",
        localRoot: gitContext.root,
        agentKind: adapter.kind,
        manifestDigest: manifest.digest,
        provisioningFingerprint,
        fileCount: manifest.files.length,
        totalBytes: manifest.totalBytes,
        createdAt: Date.now(),
        expiresAt: Date.now() + config.uploadApprovalSeconds * 1000,
      };
      return state;
    });
    printManifest(
      manifest,
      target,
      "Start configured agent in Blaxel",
      config.uploadApprovalSeconds,
    );
    return emitResult("start-agent", "needs_upload_approval", {
      manifestDigest: manifest.digest,
      provisioningFingerprint,
      workspace: blaxelWorkspace,
      fileCount: manifest.files.length,
      totalBytes: manifest.totalBytes,
      expiresInSeconds: config.uploadApprovalSeconds,
    });
  }

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const mapping = {
    schemaVersion: 1,
    id,
    agentKind: adapter.kind,
    sourcePaneId: gitContext.sourcePaneId,
    remotePaneId: null,
    blaxelWorkspace,
    sandboxName,
    localRoot: gitContext.root,
    localCwd: gitContext.cwd,
    relativeCwd: gitContext.relativeCwd,
    remoteRoot: config.remoteRoot,
    lifecycleState: "provisional",
    uploadManifestDigest: manifest.digest,
    lastAppliedExportCommit: null,
    installedVersion: null,
    capabilities: {},
    createdAt,
    updatedAt: createdAt,
  };
  await updateState((state) => {
    requireNoExistingMapping(state, gitContext, adapter.kind);
    const approved = state.pendingStarts[key];
    if (
      !pendingStartMatches(approved, manifest.digest, provisioningFingerprint)
    ) {
      throw new PluginError(
        "upload_approval_expired",
        "The upload approval expired or changed.",
      );
    }
    delete state.pendingStarts[key];
    state.mappings[id] = mapping;
    return state;
  });

  try {
    const provisioned = await provisionSandbox({
      mapping,
      manifest,
      config,
      adapter,
      onLifecycle: (lifecycleState) => patchMapping(id, { lifecycleState }),
    });
    const ready = await patchMapping(id, {
      lifecycleState: "ready",
      lastAppliedExportCommit: provisioned.baselineCommit,
      installedVersion: provisioned.installedVersion,
      capabilities: provisioned.capabilities,
    });
    openPluginPane("agent", context, {
      placement: "split",
      targetPaneId: gitContext.sourcePaneId,
      env: {
        BLAXEL_HERDR_MAPPING_ID: id,
        HERDR_AGENT: adapter.herdrDetectionKind,
      },
    });
    return emitResult("start-agent", "ready", {
      mappingId: id,
      sandboxName: ready.sandboxName,
      agent: ready.agentKind,
      manifestDigest: manifest.digest,
    });
  } catch (error) {
    await patchMapping(id, {
      lifecycleState: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
}

function mappingFromContext(context) {
  return requireMapping(readState(), context, {
    agentKind: loadConfig().agent,
  });
}

export async function reconnect(context) {
  const mapping = mappingFromContext(context);
  if (["deleting", "deleted"].includes(mapping.lifecycleState)) {
    throw new PluginError(
      "mapping_not_connectable",
      `Mapping ${mapping.id} is ${mapping.lifecycleState}.`,
    );
  }
  const config = loadConfig();
  const adapter = getAdapter(mapping.agentKind);
  const workspace = mapping.blaxelWorkspace ?? config.workspace;
  const info = await sandboxInfo(mapping);
  if (!info.exists) {
    await patchMapping(mapping.id, { lifecycleState: "missing" });
    throw new PluginError(
      "sandbox_not_found",
      `Sandbox ${mapping.sandboxName} no longer exists. Use Replace.`,
    );
  }
  await patchMapping(mapping.id, { lifecycleState: "ready", lastError: null });
  openPluginPane("agent", context, {
    placement: "split",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      HERDR_AGENT: adapter.herdrDetectionKind,
      ...(workspace ? { BL_WORKSPACE: workspace } : {}),
    },
  });
  return emitResult("reconnect", "opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export async function applyChanges(context) {
  const mapping = mappingFromContext(context);
  const result = await exportAndApplyPatch(mapping);
  await patchMapping(mapping.id, {
    lastAppliedExportCommit: result.nextCommit,
  });
  return emitResult("apply-changes", result.status, {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
    bytes: result.bytes,
    remoteCommit: result.nextCommit,
  });
}

export async function stop(context) {
  const mapping = mappingFromContext(context);
  const result = await stopAgent(mapping);
  await patchMapping(mapping.id, {
    lifecycleState: result.status,
    remotePaneId: null,
  });
  if (mapping.remotePaneId) {
    closePluginPane(mapping.remotePaneId, { check: false });
  }
  return emitResult("stop", result.status, {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export async function info(context) {
  const mapping = mappingFromContext(context);
  const remote = await sandboxInfo(mapping);
  const output = {
    mappingId: mapping.id,
    agent: mapping.agentKind,
    sandboxName: mapping.sandboxName,
    lifecycle: mapping.lifecycleState,
    localRoot: mapping.localRoot,
    remoteRoot: mapping.remoteRoot,
    installedVersion: mapping.installedVersion,
    capabilities: mapping.capabilities,
    remote,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return emitResult("info", remote.exists ? "ready" : "missing", output);
}

export async function logs(context) {
  const mapping = mappingFromContext(context);
  const output = await captureAgentOutput(mapping);
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  return emitResult("logs", "shown", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
    lineCount: output.split("\n").length,
  });
}

export async function previews(context) {
  const mapping = mappingFromContext(context);
  openPluginPane("previews", context, {
    placement: "popup",
    env: { BLAXEL_HERDR_MAPPING_ID: mapping.id },
  });
  return emitResult("previews", "opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export async function dashboard(context) {
  openPluginPane("dashboard", context, {
    placement: "zoomed",
  });
  return emitResult("dashboard", "opened", { pane: "dashboard" });
}

export async function requestDelete(context) {
  const mapping = mappingFromContext(context);
  openPluginPane("confirmation", context, {
    placement: "popup",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      BLAXEL_HERDR_DESTRUCTIVE_ACTION: "delete",
    },
  });
  return emitResult("delete-sandbox", "confirmation_opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export async function requestReplace(context) {
  const mapping = mappingFromContext(context);
  const config = loadConfig();
  const adapter = getAdapter(mapping.agentKind);
  const blaxelWorkspace =
    mapping.blaxelWorkspace ?? resolveBlaxelWorkspace(config);
  const provisioningFingerprint = approvalFingerprint({
    config,
    adapter,
    workspace: blaxelWorkspace,
  });
  const target = approvalTarget(
    config,
    adapter,
    blaxelWorkspace,
    mapping.sandboxName,
  );
  const manifest = buildUploadManifest(mapping.localRoot, config);
  const key = `replace:${mapping.id}`;
  const pending = readState().pendingStarts[key];
  if (!pendingStartMatches(pending, manifest.digest, provisioningFingerprint)) {
    await updateState((state) => {
      state.pendingStarts[key] = {
        operation: "replace",
        mappingId: mapping.id,
        manifestDigest: manifest.digest,
        provisioningFingerprint,
        fileCount: manifest.files.length,
        totalBytes: manifest.totalBytes,
        createdAt: Date.now(),
        expiresAt: Date.now() + config.uploadApprovalSeconds * 1000,
      };
      return state;
    });
    printManifest(
      manifest,
      target,
      "Replace Blaxel sandbox",
      config.uploadApprovalSeconds,
    );
    return emitResult("replace-sandbox", "needs_upload_approval", {
      mappingId: mapping.id,
      sandboxName: mapping.sandboxName,
      manifestDigest: manifest.digest,
      provisioningFingerprint,
      workspace: blaxelWorkspace,
      expiresInSeconds: config.uploadApprovalSeconds,
    });
  }
  openPluginPane("confirmation", context, {
    placement: "popup",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      BLAXEL_HERDR_DESTRUCTIVE_ACTION: "replace",
      BLAXEL_HERDR_MANIFEST_DIGEST: manifest.digest,
      BLAXEL_HERDR_PROVISIONING_FINGERPRINT: provisioningFingerprint,
    },
  });
  return emitResult("replace-sandbox", "confirmation_opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
    manifestDigest: manifest.digest,
    provisioningFingerprint,
  });
}

export const ACTIONS = Object.freeze({
  "connect-blaxel": connectBlaxel,
  "start-agent": startAgent,
  reconnect,
  "apply-changes": applyChanges,
  stop,
  info,
  logs,
  previews,
  dashboard,
  "replace-sandbox": requestReplace,
  "delete-sandbox": requestDelete,
});

export async function runAction(actionId = process.env.HERDR_PLUGIN_ACTION_ID) {
  const action = ACTIONS[actionId];
  if (!action)
    throw new PluginError(
      "unknown_action",
      `Unknown action: ${actionId || "<missing>"}.`,
    );
  const context = parsePluginContext();
  return action(context);
}
