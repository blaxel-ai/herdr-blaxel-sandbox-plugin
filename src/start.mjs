import crypto from "node:crypto";

import { adapterSecretEnvironment, getAdapter } from "./adapters.mjs";
import { loadConfig } from "./config.mjs";
import { resolveGitContext } from "./context.mjs";
import { buildUploadManifest, startSnapshotFingerprint } from "./manifest.mjs";
import { nowIso, patchMapping } from "./mappings.mjs";
import { PluginError } from "./result.mjs";
import {
  provisionSandbox,
  resolveBlaxelWorkspace,
  sandboxNameFor,
} from "./sandbox.mjs";
import { updateState } from "./state.mjs";

export function startTarget(config, adapter, workspace, sandboxName) {
  const secretEnvironment = adapterSecretEnvironment(adapter).map(
    ({ name }) => name,
  );
  return {
    sandboxName,
    workspace,
    agent: `${adapter.title} ${adapter.expectedVersion}`,
    agentArgs: config.agentArgs,
    secretEnvironment,
    image: config.image,
    region: config.region,
    memory: config.memory,
    remoteRoot: config.remoteRoot,
    idleDelete: config.idleDelete,
    previewPorts: config.previewPorts,
    publicPreviews: config.publicPreviews,
  };
}

export function prepareStart(context, options = {}) {
  const config = options.config ?? loadConfig();
  const adapter = options.adapter ?? getAdapter(config.agent);
  const workspace = (options.resolveWorkspace ?? resolveBlaxelWorkspace)(
    config,
  );
  const gitContext = (options.resolveGitContext ?? resolveGitContext)(context);
  const mappingId = options.mappingId ?? crypto.randomUUID();
  const sandboxName = sandboxNameFor({
    prefix: config.sandboxNamePrefix,
    agentKind: adapter.kind,
    localRoot: gitContext.root,
    sourcePaneId: gitContext.sourcePaneId,
    instanceId: mappingId,
  });
  const manifest = (options.buildManifest ?? buildUploadManifest)(
    gitContext.root,
    config,
  );
  const provisioningFingerprint = startSnapshotFingerprint({
    config,
    adapter,
    workspace,
  });
  return {
    context,
    config,
    adapter,
    workspace,
    gitContext,
    sandboxName,
    mappingId,
    manifest,
    provisioningFingerprint,
    target: startTarget(config, adapter, workspace, sandboxName),
    preparedAt: Date.now(),
  };
}

function revalidateStart(prepared, options = {}) {
  const fresh = prepareStart(prepared.context, {
    ...options,
    mappingId: prepared.mappingId,
  });
  if (
    fresh.manifest.digest !== prepared.manifest.digest ||
    fresh.provisioningFingerprint !== prepared.provisioningFingerprint ||
    fresh.sandboxName !== prepared.sandboxName ||
    fresh.gitContext.root !== prepared.gitContext.root ||
    fresh.gitContext.sourcePaneId !== prepared.gitContext.sourcePaneId
  ) {
    throw new PluginError(
      "start_snapshot_changed",
      "The target, configuration, or filtered upload changed while Start was running. Run Start again.",
    );
  }
  return fresh;
}

export async function provisionStart(prepared, options = {}) {
  const fresh = revalidateStart(prepared, options);
  const id = fresh.mappingId;
  const createdAt = nowIso();
  const mapping = {
    schemaVersion: 1,
    id,
    agentKind: fresh.adapter.kind,
    sourcePaneId: fresh.gitContext.sourcePaneId,
    remotePaneId: null,
    blaxelWorkspace: fresh.workspace,
    sandboxName: fresh.sandboxName,
    localRoot: fresh.gitContext.root,
    localCwd: fresh.gitContext.cwd,
    relativeCwd: fresh.gitContext.relativeCwd,
    remoteRoot: fresh.config.remoteRoot,
    lifecycleState: "provisional",
    uploadManifestDigest: fresh.manifest.digest,
    lastAppliedExportCommit: null,
    installedVersion: null,
    capabilities: {},
    createdAt,
    updatedAt: createdAt,
  };
  await updateState((state) => {
    if (state.mappings[id]) {
      throw new PluginError(
        "mapping_id_collision",
        "Start generated a duplicate mapping identifier. Run Start again.",
      );
    }
    state.mappings[id] = mapping;
    return state;
  });
  try {
    const provision = options.provision ?? provisionSandbox;
    const provisioned = await provision({
      mapping,
      manifest: fresh.manifest,
      config: fresh.config,
      adapter: fresh.adapter,
      onLifecycle: async (lifecycleState) => {
        await patchMapping(id, { lifecycleState });
        await options.onLifecycle?.(lifecycleState);
      },
    });
    const ready = await patchMapping(id, {
      lifecycleState: "ready",
      lastAppliedExportCommit: provisioned.baselineCommit,
      installedVersion: provisioned.installedVersion,
      capabilities: provisioned.capabilities,
      lastError: null,
    });
    return { mapping: ready, manifest: fresh.manifest };
  } catch (error) {
    await patchMapping(id, {
      lifecycleState: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
}
