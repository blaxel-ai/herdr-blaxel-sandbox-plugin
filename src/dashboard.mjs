#!/usr/bin/env node
import { getAdapter } from "./adapters.mjs";
import {
  formatAge,
  missingMappingsToPrune,
  repositoryInfo,
} from "./dashboard-model.mjs";
import { parsePluginContext } from "./context.mjs";
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
  const text = String(value ?? "");
  if (width <= 1) return text.slice(0, width);
  return text.length <= width
    ? text.padEnd(width)
    : `${text.slice(0, width - 1)}…`;
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
  const width = Math.max(80, process.stdout.columns ?? 120);
  const repoWidth = Math.min(28, Math.max(18, Math.floor(width * 0.22)));
  const sandboxWidth = Math.min(38, Math.max(24, width - repoWidth - 46));
  process.stdout.write("\u001b[2J\u001b[H\u001b[?25l");
  process.stdout.write(
    `Blaxel Sandboxes  ${syncing ? "syncing" : "live"}  ${items.length} tracked\n\n`,
  );
  process.stdout.write(
    `   ${truncate("REPOSITORY / BRANCH", repoWidth)}  ${truncate("SANDBOX", sandboxWidth)}  ${truncate("AGENT", 12)}  ${truncate("STATE", 11)}  AGE\n`,
  );
  process.stdout.write(
    `   ${"-".repeat(repoWidth)}  ${"-".repeat(sandboxWidth)}  ${"-".repeat(12)}  ${"-".repeat(11)}  ---\n`,
  );
  if (items.length === 0) {
    process.stdout.write(
      "   No tracked Sandboxes. Run sbx from a Git worktree.\n",
    );
  }
  for (const item of items) {
    const repository = repo(item);
    const marker = item.id === mapping?.id ? ">" : " ";
    process.stdout.write(
      `${marker}  ${truncate(`${repository.name} / ${repository.branch}`, repoWidth)}  ${truncate(item.sandboxName, sandboxWidth)}  ${truncate(item.agentKind, 12)}  ${truncate(remoteLabel(item), 11)}  ${formatAge(item.createdAt)}\n`,
    );
  }
  if (mapping) {
    const repository = repo(mapping);
    const remote = remoteCache.get(mapping.id);
    process.stdout.write(
      `\nSelected\n  Repository: ${repository.path}${mapping.relativeCwd === "." ? "" : ` (${mapping.relativeCwd})`}\n  Sandbox:   ${mapping.sandboxName}\n  Workspace: ${mapping.blaxelWorkspace}\n  Agent:     ${mapping.agentKind}${mapping.installedVersion ? ` ${mapping.installedVersion}` : ""}\n  State:     local ${mapping.lifecycleState} / remote ${remoteLabel(mapping)}\n  Cleanup:   ${remote?.ttl ? `automatic after ${remote.ttl} idle` : "checking idle policy"}\n`,
    );
  }
  process.stdout.write(
    "\n[up/down or j/k] Select  [enter/c] Connect  [n] New  [a] Apply  [i] Info  [l] Logs\n[p] Previews  [s] Stop  [x] Replace  [d] Delete  [r] Refresh  [q] Close\n",
  );
  if (message) process.stdout.write(`\n${truncate(message, width - 2)}\n`);
}

function openOperation(operation, mapping) {
  openPluginPane("operation", context, {
    placement: "popup",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      BLAXEL_HERDR_OPERATION: operation,
    },
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
  const adapter = getAdapter(mapping.agentKind);
  const workspaceId =
    mapping.sourcePaneId?.split(":", 1)[0] ?? context.workspace_id;
  const sourceContext = {
    workspace_id: workspaceId,
    workspace_cwd: mapping.localRoot,
    focused_pane_id: mapping.sourcePaneId,
    focused_pane_cwd: mapping.localCwd,
    worktree: { checkout_path: mapping.localRoot },
  };
  openPluginPane("start", context, {
    placement: "tab",
    workspaceId,
    env: {
      BLAXEL_HERDR_SOURCE_CONTEXT_JSON: JSON.stringify(sourceContext),
      HERDR_AGENT: adapter.herdrDetectionKind,
    },
  });
}

function destructive(action, mapping) {
  openPluginPane("confirmation", context, {
    placement: "popup",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      BLAXEL_HERDR_DESTRUCTIVE_ACTION: action,
    },
  });
}

async function pruneExpired(items) {
  const ids = missingMappingsToPrune(items, remoteCache, missingCounts);
  if (ids.length === 0) return;
  const removed = [];
  await updateState((state) => {
    for (const id of ids) {
      const mapping = state.mappings[id];
      if (!mapping) continue;
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
    return;
  }
  if (key === "\u001b[A" || key === "k") select(items, -1);
  else if (key === "\u001b[B" || key === "j") select(items, 1);
  else if ((key === "\r" || key === "\n" || key === "c") && mapping) {
    connect(mapping);
    message = `Opened ${mapping.sandboxName}.`;
  } else if (key === "n" && mapping) {
    createAnother(mapping);
    message = `Creating another Sandbox for ${repo(mapping).name}.`;
  } else if (key === "a" && mapping) openOperation("apply-changes", mapping);
  else if (key === "i" && mapping) openOperation("info", mapping);
  else if (key === "l" && mapping) openOperation("logs", mapping);
  else if (key === "s" && mapping) openOperation("stop", mapping);
  else if (key === "p" && mapping) {
    openPluginPane("previews", context, {
      placement: "popup",
      env: { BLAXEL_HERDR_MAPPING_ID: mapping.id },
    });
  } else if (key === "x" && mapping) destructive("replace", mapping);
  else if (key === "d" && mapping) destructive("delete", mapping);
  else if (key === "r") {
    message = "Refreshing Blaxel state...";
    void refreshRemote();
  }
  render();
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("The Blaxel dashboard requires an interactive terminal.");
  process.exitCode = 1;
} else {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdout.write("\u001b[?1049h");
  render();
  void refreshRemote();
  const syncTimer = setInterval(() => void refreshRemote(), 2_000);
  const renderTimer = setInterval(render, 1_000);
  try {
    for await (const key of process.stdin) {
      await handleKey(key);
      if (!running) break;
    }
  } finally {
    clearInterval(syncTimer);
    clearInterval(renderTimer);
    syncGeneration += 1;
    process.stdin.setRawMode(false);
    process.stdout.write("\u001b[?25h\u001b[?1049l");
  }
}
