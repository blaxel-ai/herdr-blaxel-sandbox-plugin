import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { LIFECYCLE_STATES, STATE_SCHEMA_VERSION } from "./constants.mjs";
import { PluginError } from "./result.mjs";

const AGENT_KINDS = new Set(["codex", "claude-code", "opencode"]);
const SANDBOX_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function nullableString(value) {
  return value === null || nonEmptyString(value);
}

function safeRelativePath(value) {
  return (
    value === "." ||
    (nonEmptyString(value) &&
      !path.posix.isAbsolute(value) &&
      path.posix.normalize(value) === value &&
      value !== ".." &&
      !value.startsWith("../"))
  );
}

function validateMapping(id, mapping) {
  if (
    !mapping ||
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    mapping.schemaVersion !== STATE_SCHEMA_VERSION ||
    mapping.id !== id ||
    !AGENT_KINDS.has(mapping.agentKind) ||
    !nullableString(mapping.sourcePaneId) ||
    !nullableString(mapping.remotePaneId) ||
    !nonEmptyString(mapping.blaxelWorkspace) ||
    !SANDBOX_NAME.test(mapping.sandboxName ?? "") ||
    !path.isAbsolute(mapping.localRoot ?? "") ||
    !path.isAbsolute(mapping.localCwd ?? "") ||
    !safeRelativePath(mapping.relativeCwd) ||
    !path.posix.isAbsolute(mapping.remoteRoot ?? "") ||
    path.posix.normalize(mapping.remoteRoot) !== mapping.remoteRoot ||
    (mapping.remoteRoot !== "/workspace" &&
      !mapping.remoteRoot.startsWith("/workspace/")) ||
    !SHA256.test(mapping.uploadManifestDigest ?? "") ||
    !(
      mapping.lastAppliedExportCommit === null ||
      GIT_COMMIT.test(mapping.lastAppliedExportCommit ?? "")
    ) ||
    !(
      mapping.installedVersion === null ||
      nonEmptyString(mapping.installedVersion)
    ) ||
    !mapping.capabilities ||
    typeof mapping.capabilities !== "object" ||
    Array.isArray(mapping.capabilities) ||
    !nonEmptyString(mapping.createdAt) ||
    !nonEmptyString(mapping.updatedAt)
  ) {
    throw new PluginError("invalid_state", `Mapping ${id} is invalid.`);
  }
  const relative = path.relative(mapping.localRoot, mapping.localCwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new PluginError(
      "invalid_state",
      `Mapping ${id} has a local path outside its worktree.`,
    );
  }
  if (!LIFECYCLE_STATES.has(mapping.lifecycleState)) {
    throw new PluginError(
      "invalid_state",
      `Mapping ${id} has invalid lifecycle ${mapping.lifecycleState}.`,
    );
  }
}

export function stateDirectory(env = process.env) {
  const directory = env.HERDR_PLUGIN_STATE_DIR;
  if (!directory) {
    throw new PluginError(
      "missing_plugin_state_dir",
      "HERDR_PLUGIN_STATE_DIR is not set.",
    );
  }
  return path.resolve(directory);
}

export function emptyState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    mappings: {},
  };
}

export function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new PluginError(
      "invalid_state",
      "Plugin state must contain one object.",
    );
  }
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new PluginError(
      "unsupported_state_version",
      `Unsupported state schema: ${state.schemaVersion}.`,
    );
  }
  if (
    !state.mappings ||
    typeof state.mappings !== "object" ||
    Array.isArray(state.mappings)
  ) {
    throw new PluginError("invalid_state", "Plugin mappings are invalid.");
  }
  for (const [id, mapping] of Object.entries(state.mappings)) {
    validateMapping(id, mapping);
  }
  return state;
}

export function statePath(directory = stateDirectory()) {
  return path.join(directory, "state.json");
}

export function readState(options = {}) {
  const file = options.file ?? statePath(options.directory);
  if (!fs.existsSync(file)) return emptyState();
  try {
    return validateState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error instanceof PluginError) throw error;
    throw new PluginError(
      "invalid_state",
      `Could not read ${file}: ${error.message}`,
    );
  }
}

async function acquireLock(lockPath, options = {}) {
  const attempts = options.attempts ?? 100;
  const interval = options.interval ?? 20;
  const staleMs = options.staleMs ?? 60_000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(handle, `${process.pid}\n`, "utf8");
      return handle;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (removeStaleLock(lockPath, staleMs)) continue;
      await delay(interval);
    }
  }
  throw new PluginError(
    "state_lock_timeout",
    "Timed out while waiting for the plugin state lock.",
  );
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function removeStaleLock(lockPath, staleMs) {
  let before;
  let owner;
  try {
    before = fs.statSync(lockPath);
    owner = Number.parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
  } catch (error) {
    return error.code === "ENOENT";
  }
  const ownerIsValid = Number.isSafeInteger(owner) && owner > 0;
  const oldEnough = Date.now() - before.mtimeMs >= staleMs;
  if ((ownerIsValid && processExists(owner)) || (!ownerIsValid && !oldEnough)) {
    return false;
  }
  try {
    const current = fs.statSync(lockPath);
    if (current.dev !== before.dev || current.ino !== before.ino) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

export async function updateState(change, options = {}) {
  const directory = options.directory ?? stateDirectory(options.env);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = options.file ?? statePath(directory);
  const lockPath = `${file}.lock`;
  const lock = await acquireLock(lockPath, options.lock);
  try {
    const current = readState({ file });
    const next = (await change(structuredClone(current))) ?? current;
    validateState(next);
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
    return next;
  } finally {
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}

export function mappingForPane(state, paneId, options = {}) {
  if (!paneId) return null;
  const mappings = Object.values(state.mappings);
  const remote = mappings.find((mapping) => mapping.remotePaneId === paneId);
  if (remote) return remote;
  const source = mappings.filter(
    (mapping) =>
      mapping.sourcePaneId === paneId &&
      (!options.agentKind || mapping.agentKind === options.agentKind),
  );
  return source.length === 1 ? source[0] : null;
}

export function mappingForContext(state, context, options = {}) {
  const explicitId = options.mappingId ?? process.env.BLAXEL_HERDR_MAPPING_ID;
  if (explicitId && state.mappings[explicitId])
    return state.mappings[explicitId];
  const paneId = context.focused_pane_id ?? process.env.HERDR_PANE_ID;
  const byPane = mappingForPane(state, paneId, options);
  if (byPane) return byPane;
  const cwd =
    context.focused_pane_cwd ??
    context.worktree?.checkout_path ??
    context.workspace_cwd;
  if (!cwd) return null;
  const matches = Object.values(state.mappings).filter(
    (mapping) =>
      (mapping.localRoot === cwd || mapping.localCwd === cwd) &&
      (!options.agentKind || mapping.agentKind === options.agentKind),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function requireMapping(state, context, options = {}) {
  const mapping = mappingForContext(state, context, options);
  if (!mapping) {
    throw new PluginError(
      "mapping_not_found",
      "No Blaxel sandbox mapping matches the focused pane.",
    );
  }
  return mapping;
}
