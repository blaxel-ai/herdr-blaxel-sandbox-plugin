#!/usr/bin/env node
import readline from "node:readline/promises";

import { closePluginPane } from "./herdr.mjs";
import { patchMapping } from "./mappings.mjs";
import { applyPreparedPatch, preparePatch } from "./patch.mjs";
import { PluginError, errorMessage } from "./result.mjs";
import { captureAgentOutput, sandboxInfo, stopAgent } from "./sandbox.mjs";
import { readState } from "./state.mjs";

const operation = process.env.BLAXEL_HERDR_OPERATION || "unknown";

function requireMapping() {
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

function header(title, mapping) {
  process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write(`${title}\n\nSandbox: ${mapping.sandboxName}\n\n`);
}

async function ask(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PluginError(
      "interactive_approval_required",
      "This operation requires an interactive Herdr terminal.",
    );
  }
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

async function showInfo(mapping) {
  header("Blaxel Sandbox info", mapping);
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
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function showLogs(mapping) {
  header("Blaxel agent output", mapping);
  const output = await captureAgentOutput(mapping);
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

async function stop(mapping) {
  header("Stop Blaxel agent", mapping);
  process.stdout.write("Stopping the persistent agent session...\n");
  const result = await stopAgent(mapping);
  await patchMapping(mapping.id, {
    lifecycleState: result.status,
    remotePaneId: null,
  });
  if (mapping.remotePaneId) {
    closePluginPane(mapping.remotePaneId, { check: false });
  }
  process.stdout.write(
    `\n${result.status === "stopped" ? "Agent stopped. Sandbox files are preserved." : "The Sandbox is no longer available."}\n`,
  );
}

async function applyChanges(mapping) {
  header("Apply Blaxel changes locally", mapping);
  process.stdout.write("Exporting and checking the remote Git patch...\n\n");
  const prepared = await preparePatch(mapping);
  try {
    process.stdout.write(`${prepared.summary}\n`);
    if (prepared.status === "ready") {
      process.stdout.write(`\nPatch size: ${prepared.bytes} bytes\n`);
      const answer = await ask(
        "Apply these changes to the local worktree? [y/N] ",
      );
      if (!new Set(["y", "yes"]).has(answer.trim().toLowerCase())) {
        process.stdout.write(
          "\nCanceled. The local worktree was not changed.\n",
        );
        return;
      }
    }
    const result = applyPreparedPatch(prepared, mapping);
    await patchMapping(mapping.id, {
      lastAppliedExportCommit: result.nextCommit,
    });
    process.stdout.write(
      `\n${result.status === "applied" ? "Changes applied locally." : result.summary}\n`,
    );
  } finally {
    prepared.cleanup();
  }
}

try {
  const mapping = requireMapping();
  if (operation === "info") await showInfo(mapping);
  else if (operation === "logs") await showLogs(mapping);
  else if (operation === "stop") await stop(mapping);
  else if (operation === "apply-changes") await applyChanges(mapping);
  else {
    throw new PluginError(
      "unknown_operation",
      `Unsupported Blaxel operation: ${operation}.`,
    );
  }
  await ask("\nPress Enter to close. ");
} catch (error) {
  process.stdout.write(`\n${errorMessage(error)}\n`);
  await ask("\nPress Enter to close. ").catch(() => {});
  process.exitCode = 1;
}
