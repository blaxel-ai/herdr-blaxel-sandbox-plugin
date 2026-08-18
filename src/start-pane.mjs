#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

import { loadConfig } from "./config.mjs";
import { parsePluginContext } from "./context.mjs";
import { herdrBinary } from "./herdr.mjs";
import { formatManifest } from "./manifest.mjs";
import { runSync } from "./process.mjs";
import { PluginError, errorMessage } from "./result.mjs";
import { prepareStart, provisionStart } from "./start.mjs";

function sourceContext() {
  return parsePluginContext(
    process.env.BLAXEL_HERDR_SOURCE_CONTEXT_JSON ??
      process.env.HERDR_PLUGIN_CONTEXT_JSON,
  );
}

async function runLogin() {
  const config = loadConfig();
  const args = config.workspace ? ["login", config.workspace] : ["login"];
  process.stdout.write(
    "Blaxel sign-in or workspace selection is required.\nOpening the official Blaxel login flow...\n\n",
  );
  const child = spawn("bl", args, { stdio: "inherit", env: process.env });
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new PluginError(
      "blaxel_login_failed",
      `Blaxel login exited with code ${exitCode}.`,
    );
  }
}

async function prepareWithLogin(context) {
  try {
    return prepareStart(context);
  } catch (error) {
    if (
      error instanceof PluginError &&
      ["blaxel_login_required", "blaxel_workspace_unavailable"].includes(
        error.code,
      )
    ) {
      await runLogin();
      return prepareStart(context);
    }
    throw error;
  }
}

function showStart(prepared) {
  process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write("Start in Blaxel\n\n");
  process.stdout.write(
    `${formatManifest(prepared.manifest, {
      target: prepared.target,
      approvalPrompt: false,
    })}\n`,
  );
}

async function waitForDismiss() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await terminal.question("\nPress Enter to close. ");
  terminal.close();
}

try {
  const context = sourceContext();
  const prepared = await prepareWithLogin(context);
  showStart(prepared);
  process.stdout.write("\nCreating Sandbox...\n");
  const labels = {
    creating: "Sandbox created",
    uploading: "Uploading filtered files",
    preparing: `Installing and preparing ${prepared.adapter.title}`,
  };
  const result = await provisionStart(prepared, {
    onLifecycle: (lifecycle) => {
      process.stdout.write(`  ${labels[lifecycle] ?? lifecycle}...\n`);
    },
  });
  process.stdout.write(
    `\nReady: ${result.mapping.sandboxName}\nConnecting the persistent ${prepared.adapter.title} terminal...\n`,
  );
  if (process.env.HERDR_PANE_ID) {
    runSync(
      herdrBinary(),
      ["pane", "rename", process.env.HERDR_PANE_ID, "Blaxel agent"],
      { check: false },
    );
  }
  const agentPane = spawn(
    process.execPath,
    [fileURLToPath(new URL("./agent-pane.mjs", import.meta.url))],
    {
      cwd: result.mapping.localCwd,
      stdio: "inherit",
      env: {
        ...process.env,
        BLAXEL_HERDR_MAPPING_ID: result.mapping.id,
        HERDR_AGENT: prepared.adapter.herdrDetectionKind,
        BL_WORKSPACE: result.mapping.blaxelWorkspace,
      },
    },
  );
  const exitCode = await new Promise((resolve, reject) => {
    agentPane.on("error", reject);
    agentPane.on("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} catch (error) {
  process.stdout.write(`\nCould not start in Blaxel: ${errorMessage(error)}\n`);
  await waitForDismiss();
  process.exitCode = 1;
}
