#!/usr/bin/env node
import { listAdapters, getAdapter } from "./adapters.mjs";
import {
  formatAge,
  missingMappingsToPrune,
  repositoryInfo,
} from "./dashboard-model.mjs";
import { parsePluginContext } from "./context.mjs";
import { loadConfig, saveConfig } from "./config.mjs";
import { runOperation } from "./operation-pane.mjs";
import { runDestructive } from "./confirmation-pane.mjs";
import { showPreviews } from "./previews-pane.mjs";
import { TerminalUI, plainText, fit } from "./terminal-ui.mjs";
import stringWidth from "string-width";
import { closePluginPane, openPluginPane } from "./herdr.mjs";
import { sandboxInfo } from "./sandbox.mjs";
import { readState, updateState } from "./state.mjs";

const context = parsePluginContext();
const remoteCache = new Map();
const repositoryCache = new Map();
const missingCounts = new Map();
let selectedId = null;
let message = "Loading Blaxel state...";
let running = true;
let syncing = false;
let syncGeneration = 0;
let finish;
const terminal = new TerminalUI({
  onKey: (text, key) => {
    const value =
      key.name === "escape"
        ? "q"
        : key.name === "up"
          ? "k"
          : key.name === "down"
            ? "j"
            : key.name === "return"
              ? "c"
              : key.ctrl && key.name === "c"
                ? "q"
                : text;
    void handleKey(value).catch((error) => {
      message = error.message;
      render();
    });
  },
});

function mappings() {
  return Object.values(readState().mappings).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

function selectedIndex(items) {
  const index = items.findIndex(({ id }) => id === selectedId);
  return index < 0 ? 0 : index;
}

function select(items, offset) {
  if (items.length === 0) {
    selectedId = null;
    return;
  }
  const index = selectedIndex(items);
  selectedId = items[(index + offset + items.length) % items.length].id;
}

function selectedMapping() {
  const items = mappings();
  if (items.length === 0) return null;
  const mapping = items.find(({ id }) => id === selectedId) ?? items[0];
  selectedId = mapping.id;
  return mapping;
}

function truncate(value, width) {
  const text = plainText(value ?? "");
  return stringWidth(text) <= width
    ? fit(text, width)
    : `${fit(text, Math.max(0, width - 1))}…`;
}

function repo(mapping) {
  if (!repositoryCache.has(mapping.localRoot)) {
    repositoryCache.set(mapping.localRoot, repositoryInfo(mapping));
  }
  return repositoryCache.get(mapping.localRoot);
}

function remoteLabel(mapping) {
  const remote = remoteCache.get(mapping.id);
  if (!remote) return "checking";
  if (remote.error) return "error";
  return String(remote.status ?? "unknown").toLowerCase();
}

function render() {
  const items = mappings();
  const mapping = selectedMapping();
  const config = loadConfig();
  const width = process.stdout.columns ?? 100;
  const height = process.stdout.rows ?? 30;
  const repositoryWidth = Math.max(12, Math.min(32, width - 52));
  const rows = [
    "Blaxel Sandboxes",
    `${items.length} tracked  |  New: ${getAdapter(config.agent).title}  |  ${syncing ? "Refreshing" : "Ready"}`,
    "",
  ];
  if (!items.length)
    rows.push(
      "No tracked Sandboxes.",
      "Press n to start from this Git worktree, or t to choose a coding tool.",
    );
  else {
    rows.push(
      `   ${truncate("REPOSITORY / BRANCH", repositoryWidth)}  ${truncate("TOOL", 12)}  ${truncate("STATE", 11)}  AGE`,
    );
    const capacity = Math.max(1, height - 16);
    const start = Math.max(0, selectedIndex(items) - capacity + 1);
    for (const item of items.slice(start, start + capacity)) {
      const repository = repo(item);
      rows.push(
        `${item.id === mapping?.id ? ">" : " "}  ${truncate(`${repository.name} / ${repository.branch}`, repositoryWidth)}  ${truncate(getAdapter(item.agentKind).title, 12)}  ${truncate(item.lifecycleState === "connected" ? remoteLabel(item) : item.lifecycleState, 11)}  ${formatAge(item.createdAt)}`,
      );
    }
    if (items.length > capacity)
      rows.push(
        `Showing ${start + 1}-${Math.min(start + capacity, items.length)} of ${items.length}`,
      );
    const remote = remoteCache.get(mapping.id);
    rows.push(
      "",
      `Sandbox:   ${mapping.sandboxName}`,
      `Workspace: ${mapping.blaxelWorkspace}`,
      `Worktree:  ${mapping.localRoot}`,
      `Cleanup:   ${remote?.ttl ? `after ${remote.ttl} idle` : "checking idle policy"}`,
    );
    if (mapping.lastError || remote?.error)
      rows.push(`Error: ${mapping.lastError ?? remote.error}`);
  }
  rows.push("", "[n] New  [t] Tool  [w] Workspace  [r] Refresh  [q/Esc] Close");
  if (mapping)
    rows.push(
      "[j/k] Select  [Enter] Connect  [a] Apply  [i] Info  [l] Logs",
      "[p] Previews  [s] Stop  [x] Replace  [d] Delete",
    );
  if (message && message !== "Ready.") rows.push("", message);
  terminal.setBackground(rows);
}

async function openOperation(operation, mapping) {
  await terminal.modal(
    operation === "apply-changes" ? "Review changes" : `Blaxel ${operation}`,
    (ui) => runOperation(operation, mapping, ui),
  );
}

async function chooseTool() {
  await terminal.modal("Choose a coding tool", async (ui) => {
    const adapters = listAdapters();
    const config = loadConfig();
    ui.write(
      "Choose the default for new Sandboxes. Existing Sandboxes keep their tool.\n",
    );
    adapters.forEach((adapter, index) =>
      ui.write(
        `${index + 1}. ${adapter.title} ${adapter.expectedVersion}${adapter.kind === config.agent ? " (current)" : ""}`,
      ),
    );
    ui.write(
      "\nProvider keys are encrypted when present. Otherwise sign in inside the Sandbox. Switching tools resets tool arguments.",
    );
    const answer = await ui.ask("Tool number, Esc to cancel:");
    if (!answer) return;
    const adapter = adapters[Number(answer.trim()) - 1];
    if (!adapter) throw new Error("Choose a tool from the numbered list.");
    saveConfig({
      ...loadConfig(),
      agent: adapter.kind,
      agentArgs: adapter.kind === config.agent ? config.agentArgs : [],
    });
    message = `${adapter.title} selected for new Sandboxes.`;
  });
}

async function chooseWorkspace() {
  await terminal.modal("Choose a Blaxel workspace", async (ui) => {
    ui.write(
      `Current setting: ${loadConfig().workspace ?? "current CLI workspace"}\nEnter a workspace name, or type default to use the CLI workspace. Start will check login before creating anything.`,
    );
    const answer = (await ui.ask("Workspace, Esc to cancel:")).trim();
    if (!answer) return;
    if (answer !== "default" && !/^[a-z0-9][a-z0-9-]*$/.test(answer))
      throw new Error("Use the workspace name shown by bl workspaces.");
    saveConfig({
      ...loadConfig(),
      workspace: answer === "default" ? null : answer,
    });
    message = "Workspace setting saved for new Sandboxes.";
  });
}

function connect(mapping) {
  const adapter = getAdapter(mapping.agentKind);
  openPluginPane("agent", context, {
    placement: "tab",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      HERDR_AGENT: adapter.herdrDetectionKind,
      BL_WORKSPACE: mapping.blaxelWorkspace,
    },
  });
}

function createAnother(mapping) {
  const adapter = getAdapter(loadConfig().agent);
  const workspaceId =
    mapping?.sourcePaneId?.split(":", 1)[0] ?? context.workspace_id;
  const sourceContext = mapping
    ? {
        workspace_id: workspaceId,
        workspace_cwd: mapping.localRoot,
        focused_pane_id: mapping.sourcePaneId,
        focused_pane_cwd: mapping.localCwd,
        worktree: { checkout_path: mapping.localRoot },
      }
    : context;
  openPluginPane("start", context, {
    placement: "tab",
    workspaceId,
    env: {
      BLAXEL_HERDR_SOURCE_CONTEXT_JSON: JSON.stringify(sourceContext),
      HERDR_AGENT: adapter.herdrDetectionKind,
    },
  });
}

async function destructive(action, mapping) {
  await terminal.modal(
    action === "replace" ? "Replace Sandbox" : "Delete Sandbox",
    (ui) => runDestructive(action, mapping, ui, context),
  );
}

async function pruneExpired(items) {
  const ids = missingMappingsToPrune(items, remoteCache, missingCounts);
  if (ids.length === 0) return;
  const removed = [];
  await updateState((state) => {
    for (const id of ids) {
      const mapping = state.mappings[id];
      if (!mapping) continue;
      const observed = items.find((item) => item.id === id);
      if (
        !observed ||
        observed.updatedAt !== mapping.updatedAt ||
        !["ready", "connected", "stopped", "missing", "failed"].includes(
          mapping.lifecycleState,
        )
      )
        continue;
      removed.push(mapping);
      delete state.mappings[id];
    }
    return state;
  });
  for (const mapping of removed) {
    remoteCache.delete(mapping.id);
    missingCounts.delete(mapping.id);
    if (mapping.remotePaneId) {
      closePluginPane(mapping.remotePaneId, { check: false });
    }
  }
  if (removed.length > 0) {
    message = `Removed ${removed.length} expired Sandbox ${removed.length === 1 ? "mapping" : "mappings"}.`;
  }
}

async function refreshRemote() {
  if (syncing) return;
  syncing = true;
  const generation = ++syncGeneration;
  try {
    render();
    const items = mappings();
    for (const mapping of items) {
      if (!running || generation !== syncGeneration) break;
      try {
        const remote = await sandboxInfo(mapping);
        remoteCache.set(mapping.id, remote);
      } catch (error) {
        remoteCache.set(mapping.id, {
          error: error instanceof Error ? error.message : String(error),
          status: "ERROR",
        });
      }
      render();
    }
    await pruneExpired(items);
    if (message === "Loading Blaxel state...") message = "Ready.";
  } catch (error) {
    message = `Refresh failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    syncing = false;
    render();
  }
}

async function handleKey(key) {
  const items = mappings();
  const mapping = selectedMapping();
  if (key === "q" || key === "\u0003") {
    running = false;
    finish();
    return;
  }
  if (key === "\u001b[A" || key === "k") select(items, -1);
  else if (key === "\u001b[B" || key === "j") select(items, 1);
  else if ((key === "\r" || key === "\n" || key === "c") && mapping) {
    connect(mapping);
    message = `Opened ${mapping.sandboxName}.`;
  } else if (key === "t") await chooseTool();
  else if (key === "w") await chooseWorkspace();
  else if (key === "n") {
    createAnother(mapping);
    message = "Creating a new independent Sandbox.";
  } else if (key === "a" && mapping)
    await openOperation("apply-changes", mapping);
  else if (key === "i" && mapping) await openOperation("info", mapping);
  else if (key === "l" && mapping) await openOperation("logs", mapping);
  else if (key === "s" && mapping) await openOperation("stop", mapping);
  else if (key === "p" && mapping) {
    await terminal.modal("Application previews", (ui) =>
      showPreviews(mapping, ui),
    );
  } else if (key === "x" && mapping) await destructive("replace", mapping);
  else if (key === "d" && mapping) await destructive("delete", mapping);
  else if (key === "r") {
    repositoryCache.clear();
    message = "";
    void refreshRemote();
  }
  render();
}

let syncTimer;
let renderTimer;
try {
  terminal.start();
  render();
  void refreshRemote();
  syncTimer = setInterval(() => void refreshRemote(), 2_000);
  renderTimer = setInterval(render, 1_000);
  await new Promise((resolve) => {
    finish = resolve;
  });
} finally {
  clearInterval(syncTimer);
  clearInterval(renderTimer);
  running = false;
  syncGeneration += 1;
  terminal.close();
}
