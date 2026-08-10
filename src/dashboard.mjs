#!/usr/bin/env node
import { getAdapter } from "./adapters.mjs";
import { parsePluginContext } from "./context.mjs";
import { closePluginPane, openPluginPane } from "./herdr.mjs";
import { captureAgentOutput, sandboxInfo, stopAgent } from "./sandbox.mjs";
import { readState, updateState } from "./state.mjs";

const context = parsePluginContext();
let selected = 0;
let message = "";
let running = true;
let busy = false;

function truncate(value, width) {
  const text = String(value ?? "");
  return text.length <= width
    ? text.padEnd(width)
    : `${text.slice(0, width - 1)}…`;
}

async function snapshot() {
  const mappings = Object.values(readState().mappings).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const rows = [];
  // The SDK selects a workspace through process state, so cross-workspace reads must be serialized.
  for (const mapping of mappings) {
    const remote = await sandboxInfo(mapping).catch((error) => ({
      exists: false,
      status: `ERROR: ${error.message}`,
      previews: [],
    }));
    rows.push({ mapping, remote });
  }
  selected = Math.max(0, Math.min(selected, Math.max(0, rows.length - 1)));
  return rows;
}

async function render() {
  if (busy) return;
  busy = true;
  try {
    const rows = await snapshot();
    process.stdout.write("\u001b[2J\u001b[H");
    process.stdout.write("Blaxel sandboxes\n\n");
    process.stdout.write(
      "   AGENT          SANDBOX                                      LOCAL STATE   REMOTE STATE\n",
    );
    process.stdout.write(
      "   ─────────────  ───────────────────────────────────────────  ────────────  ────────────\n",
    );
    if (rows.length === 0) process.stdout.write("   No tracked sandboxes.\n");
    rows.forEach(({ mapping, remote }, index) => {
      const marker = index === selected ? "›" : " ";
      process.stdout.write(
        `${marker}  ${truncate(mapping.agentKind, 13)}  ${truncate(mapping.sandboxName, 43)}  ${truncate(mapping.lifecycleState, 12)}  ${truncate(remote.status, 12)}\n`,
      );
    });
    process.stdout.write(
      "\n↑/↓ select   c connect   s stop   l output   p previews   d delete   r refresh   q close\n",
    );
    if (message) process.stdout.write(`\n${message}\n`);
  } finally {
    busy = false;
  }
}

function selectedMapping() {
  const mappings = Object.values(readState().mappings).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  return mappings[selected] ?? null;
}

async function updateLifecycle(mappingId, fields) {
  await updateState((state) => {
    const mapping = state.mappings[mappingId];
    if (mapping) {
      state.mappings[mappingId] = {
        ...mapping,
        ...fields,
        updatedAt: new Date().toISOString(),
      };
    }
    return state;
  });
}

async function handleKey(key) {
  const mapping = selectedMapping();
  if (key === "q" || key === "\u0003") {
    running = false;
    return;
  }
  if (key === "\u001b[A") selected -= 1;
  else if (key === "\u001b[B") selected += 1;
  else if (key === "c" && mapping) {
    const adapter = getAdapter(mapping.agentKind);
    openPluginPane("agent", context, {
      placement: "tab",
      env: {
        BLAXEL_HERDR_MAPPING_ID: mapping.id,
        HERDR_AGENT: adapter.herdrDetectionKind,
      },
    });
    message = `Opened ${mapping.sandboxName}.`;
  } else if (key === "s" && mapping) {
    const result = await stopAgent(mapping);
    await updateLifecycle(mapping.id, {
      lifecycleState: result.status,
      remotePaneId: null,
    });
    if (mapping.remotePaneId) {
      closePluginPane(mapping.remotePaneId, { check: false });
    }
    message = `Stopped ${mapping.sandboxName}.`;
  } else if (key === "l" && mapping) {
    const output = await captureAgentOutput(mapping).catch(
      (error) => error.message,
    );
    message = output.split("\n").slice(-8).join("\n");
  } else if (key === "p" && mapping) {
    openPluginPane("previews", context, {
      placement: "popup",
      env: { BLAXEL_HERDR_MAPPING_ID: mapping.id },
    });
    message = `Opened previews for ${mapping.sandboxName}.`;
  } else if (key === "d" && mapping) {
    openPluginPane("confirmation", context, {
      placement: "popup",
      env: {
        BLAXEL_HERDR_MAPPING_ID: mapping.id,
        BLAXEL_HERDR_DESTRUCTIVE_ACTION: "delete",
      },
    });
    message = `Opened deletion confirmation for ${mapping.sandboxName}.`;
  } else if (key === "r") {
    message = "Refreshed.";
  }
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("The Blaxel dashboard requires an interactive terminal.");
  process.exitCode = 1;
} else {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  const timer = setInterval(() => void render(), 5_000);
  await render();
  for await (const key of process.stdin) {
    try {
      await handleKey(key);
      if (!running) break;
      await render();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      await render();
    }
  }
  clearInterval(timer);
  process.stdin.setRawMode(false);
  process.stdout.write("\u001b[2J\u001b[H");
}
