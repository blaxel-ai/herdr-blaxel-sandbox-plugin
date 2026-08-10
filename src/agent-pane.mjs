#!/usr/bin/env node
import { spawn } from "node:child_process";

import { getAdapter } from "./adapters.mjs";
import { loadConfig } from "./config.mjs";
import { PluginError, emitFailure } from "./result.mjs";
import { sandboxInfo } from "./sandbox.mjs";
import { readState, updateState } from "./state.mjs";

const action = "agent-pane";
let mappingId;

async function waitForDismiss() {
  if (process.env.HERDR_ENV !== "1") return;
  process.stdout.write("\nPress any key to close this pane.\n");
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  await new Promise((resolve) => process.stdin.once("data", resolve));
}

try {
  mappingId = process.env.BLAXEL_HERDR_MAPPING_ID;
  if (!mappingId)
    throw new PluginError(
      "mapping_id_missing",
      "BLAXEL_HERDR_MAPPING_ID is not set.",
    );
  const mapping = readState().mappings[mappingId];
  if (!mapping)
    throw new PluginError(
      "mapping_not_found",
      `Mapping ${mappingId} does not exist.`,
    );
  const adapter = getAdapter(mapping.agentKind);
  const remote = await sandboxInfo(mapping);
  if (!remote.exists)
    throw new PluginError(
      "sandbox_not_found",
      `Sandbox ${mapping.sandboxName} no longer exists.`,
    );
  await updateState((state) => {
    const current = state.mappings[mappingId];
    if (!current)
      throw new PluginError(
        "mapping_not_found",
        `Mapping ${mappingId} no longer exists.`,
      );
    state.mappings[mappingId] = {
      ...current,
      remotePaneId: process.env.HERDR_PANE_ID ?? current.remotePaneId,
      lifecycleState: "connected",
      updatedAt: new Date().toISOString(),
    };
    return state;
  });
  const config = loadConfig();
  const args = [];
  const workspace = mapping.blaxelWorkspace ?? config.workspace;
  if (workspace) args.push("--workspace", workspace);
  args.push("connect", "sandbox", mapping.sandboxName);
  const child = spawn("bl", args, {
    cwd: mapping.localCwd,
    stdio: "inherit",
    env: {
      ...process.env,
      HERDR_AGENT: adapter.herdrDetectionKind,
    },
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  await updateState((state) => {
    const current = state.mappings[mappingId];
    if (current) {
      state.mappings[mappingId] = {
        ...current,
        lifecycleState: exitCode === 0 ? "ready" : "failed",
        ...(exitCode === 0
          ? { lastError: null }
          : { lastError: `bl connect exited with code ${exitCode}` }),
        updatedAt: new Date().toISOString(),
      };
    }
    return state;
  });
  if (exitCode !== 0) {
    emitFailure(
      action,
      new PluginError(
        "bl_connect_failed",
        `The Blaxel terminal exited with code ${exitCode}.`,
      ),
    );
    await waitForDismiss();
  }
  process.exitCode = exitCode;
} catch (error) {
  if (mappingId) {
    await updateState((state) => {
      const current = state.mappings[mappingId];
      if (current) {
        state.mappings[mappingId] = {
          ...current,
          lifecycleState: "failed",
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        };
      }
      return state;
    }).catch(() => {});
  }
  emitFailure(action, error);
  await waitForDismiss();
  process.exitCode = 1;
}
