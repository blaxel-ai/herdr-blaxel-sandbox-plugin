#!/usr/bin/env node
import fs from "node:fs";
import { isMain, runPane } from "./terminal-ui.mjs";

import { closePluginPane } from "./herdr.mjs";
import { patchMapping } from "./mappings.mjs";
import { applyPreparedPatch, preparePatch } from "./patch.mjs";
import { PluginError } from "./result.mjs";
import { captureAgentOutput, sandboxInfo, stopAgent } from "./sandbox.mjs";
import { readState } from "./state.mjs";

export function requireMapping() {
  const mappingId = process.env.BLAXEL_HERDR_MAPPING_ID;
  const mapping = mappingId ? readState().mappings[mappingId] : null;
  if (!mapping) {
    throw new PluginError(
      "mapping_not_found",
      "The requested Blaxel mapping no longer exists.",
    );
  }
  return mapping;
}

function header(title, mapping, ui) {
  ui.write(`${title}\n\nSandbox: ${mapping.sandboxName}\n\n`);
}

async function showInfo(mapping, ui) {
  header("Blaxel Sandbox info", mapping, ui);
  const remote = await sandboxInfo(mapping);
  const lines = [
    `Agent: ${mapping.agentKind}${mapping.installedVersion ? ` ${mapping.installedVersion}` : ""}`,
    `Lifecycle: ${mapping.lifecycleState}`,
    `Remote status: ${remote.status}`,
    `Workspace: ${mapping.blaxelWorkspace}`,
    `Local worktree: ${mapping.localRoot}`,
    `Remote root: ${mapping.remoteRoot}`,
    `Region: ${remote.region ?? "workspace default"}`,
    `Image: ${remote.image ?? "unknown"}`,
  ];
  if (remote.previews.length > 0) {
    lines.push(
      "Previews:",
      ...remote.previews.map(
        (preview) =>
          `  ${preview.port ?? "?"}: ${preview.url ?? "not available"} (${preview.public ? "public" : "private"})`,
      ),
    );
  }
  ui.write(`${lines.join("\n")}\n`);
}

async function showLogs(mapping, ui) {
  header("Blaxel agent output", mapping, ui);
  const output = await captureAgentOutput(mapping);
  ui.write(output.endsWith("\n") ? output : `${output}\n`);
}

async function stop(mapping, ui) {
  header("Stop Blaxel agent", mapping, ui);
  ui.write("Stopping the persistent agent session...\n");
  const result = await stopAgent(mapping);
  await patchMapping(mapping.id, {
    lifecycleState: result.status,
    remotePaneId: null,
  });
  if (mapping.remotePaneId) {
    closePluginPane(mapping.remotePaneId, { check: false });
  }
  ui.write(
    `\n${result.status === "stopped" ? "Agent stopped. Sandbox files are preserved." : "The Sandbox is no longer available."}\n`,
  );
}

async function applyChanges(mapping, ui) {
  header("Apply Blaxel changes locally", mapping, ui);
  ui.write("Exporting and checking the remote Git patch...\n\n");
  const prepared = await preparePatch(mapping);
  try {
    ui.write(`${prepared.summary}\n`);
    if (prepared.status === "ready") {
      ui.write(`\nPatch size: ${prepared.bytes} bytes\n`);
      ui.write(fs.readFileSync(prepared.localPatch, "utf8"));
      const answer = await ui.ask("Apply locally? [y/N]", {
        review: true,
      });
      if (!new Set(["y", "yes"]).has(answer.trim().toLowerCase())) {
        ui.write("\nCanceled. The local worktree was not changed.\n");
        return;
      }
    }
    const result = applyPreparedPatch(prepared, mapping);
    await patchMapping(mapping.id, {
      lastAppliedExportCommit: result.nextCommit,
    });
    ui.write(
      `\n${result.status === "applied" ? "Changes applied locally." : result.summary}\n`,
    );
  } finally {
    prepared.cleanup();
  }
}

export async function runOperation(operation, mapping, ui) {
  if (operation === "info") await showInfo(mapping, ui);
  else if (operation === "logs") await showLogs(mapping, ui);
  else if (operation === "stop") await stop(mapping, ui);
  else if (operation === "apply-changes") await applyChanges(mapping, ui);
  else
    throw new PluginError(
      "unknown_operation",
      `Unsupported operation: ${operation}.`,
    );
  await ui.ask("Enter or Esc to close");
}

if (isMain(import.meta.url)) {
  const operation = process.env.BLAXEL_HERDR_OPERATION;
  await runPane(
    operation === "apply-changes" ? "Review changes" : "Blaxel Sandbox",
    (ui) => runOperation(operation, requireMapping(), ui),
  );
}
