import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_IDLE_DELETE,
  DEFAULT_IMAGE,
  DEFAULT_MEMORY_MB,
  DEFAULT_REMOTE_ROOT,
} from "./constants.mjs";
import { PluginError } from "./result.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  agent: "codex",
  agentArgs: [],
  workspace: null,
  region: null,
  image: DEFAULT_IMAGE,
  memory: DEFAULT_MEMORY_MB,
  remoteRoot: DEFAULT_REMOTE_ROOT,
  idleDelete: DEFAULT_IDLE_DELETE,
  sandboxNamePrefix: "herdr",
  previewPorts: [3000, 4173, 5173, 8000],
  publicPreviews: false,
  excludedPaths: [],
  allowSensitivePaths: [],
  maxFiles: 10_000,
  maxFileBytes: 10 * 1024 * 1024,
  maxUploadBytes: 100 * 1024 * 1024,
});

const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_CONFIG));
const AGENTS = new Set(["codex", "claude-code", "opencode"]);

function requireString(value, key, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.trim() === "") {
    throw new PluginError(
      "invalid_config",
      `${key} must be a non-empty string${nullable ? " or null" : ""}.`,
    );
  }
}

function requirePositiveInteger(value, key) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PluginError(
      "invalid_config",
      `${key} must be a positive integer.`,
    );
  }
}

function requireStringArray(value, key) {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim() !== "")
  ) {
    throw new PluginError(
      "invalid_config",
      `${key} must contain only non-empty strings.`,
    );
  }
}

function requireRepositoryPaths(value, key, { allowDirectory }) {
  requireStringArray(value, key);
  const invalid = value.find((item) => {
    const normalized = item.endsWith("/") ? item.slice(0, -1) : item;
    const components = normalized.split("/");
    return (
      item !== item.trim() ||
      item.includes("\\") ||
      item.includes("*") ||
      item.includes("?") ||
      item.startsWith("./") ||
      item.startsWith("/") ||
      (!allowDirectory && item.endsWith("/")) ||
      components.some(
        (component) =>
          component === "" || component === "." || component === "..",
      )
    );
  });
  if (invalid) {
    throw new PluginError(
      "invalid_config",
      `${key} must contain safe paths relative to the repository root.`,
    );
  }
  if (new Set(value).size !== value.length) {
    throw new PluginError(
      "invalid_config",
      `${key} must not contain duplicates.`,
    );
  }
}

export function validateConfig(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new PluginError(
      "invalid_config",
      "config.json must contain one object.",
    );
  }
  const unknown = Object.keys(candidate).filter(
    (key) => !ALLOWED_KEYS.has(key),
  );
  if (unknown.length > 0) {
    throw new PluginError(
      "invalid_config",
      `Unknown config keys: ${unknown.sort().join(", ")}.`,
    );
  }
  const config = { ...DEFAULT_CONFIG, ...candidate };
  if (!AGENTS.has(config.agent)) {
    throw new PluginError(
      "invalid_config",
      `agent must be one of: ${[...AGENTS].join(", ")}.`,
    );
  }
  requireStringArray(config.agentArgs, "agentArgs");
  requireString(config.workspace, "workspace", { nullable: true });
  requireString(config.region, "region", { nullable: true });
  requireString(config.image, "image");
  requireString(config.remoteRoot, "remoteRoot");
  requireString(config.idleDelete, "idleDelete");
  requireString(config.sandboxNamePrefix, "sandboxNamePrefix");
  if (!/^\d+[smhd]$/.test(config.idleDelete)) {
    throw new PluginError(
      "invalid_config",
      "idleDelete must use a number followed by s, m, h, or d.",
    );
  }
  if (!/[a-z0-9]/i.test(config.sandboxNamePrefix)) {
    throw new PluginError(
      "invalid_config",
      "sandboxNamePrefix must contain a letter or number.",
    );
  }
  requirePositiveInteger(config.memory, "memory");
  requirePositiveInteger(config.maxFiles, "maxFiles");
  requirePositiveInteger(config.maxFileBytes, "maxFileBytes");
  requirePositiveInteger(config.maxUploadBytes, "maxUploadBytes");
  if (
    !Array.isArray(config.previewPorts) ||
    !config.previewPorts.every(
      (port) => Number.isInteger(port) && port > 0 && port < 65_536,
    )
  ) {
    throw new PluginError(
      "invalid_config",
      "previewPorts must contain valid TCP port numbers.",
    );
  }
  if (new Set(config.previewPorts).size !== config.previewPorts.length) {
    throw new PluginError(
      "invalid_config",
      "previewPorts must not contain duplicates.",
    );
  }
  if (typeof config.publicPreviews !== "boolean") {
    throw new PluginError(
      "invalid_config",
      "publicPreviews must be true or false.",
    );
  }
  requireRepositoryPaths(config.excludedPaths, "excludedPaths", {
    allowDirectory: true,
  });
  requireRepositoryPaths(config.allowSensitivePaths, "allowSensitivePaths", {
    allowDirectory: false,
  });
  if (!path.posix.isAbsolute(config.remoteRoot)) {
    throw new PluginError(
      "invalid_config",
      "remoteRoot must be an absolute POSIX path.",
    );
  }
  if (
    path.posix.normalize(config.remoteRoot) !== config.remoteRoot ||
    !config.remoteRoot.startsWith("/workspace") ||
    (config.remoteRoot !== "/workspace" &&
      !config.remoteRoot.startsWith("/workspace/"))
  ) {
    throw new PluginError(
      "invalid_config",
      "remoteRoot must be /workspace or a normalized path below /workspace.",
    );
  }
  return config;
}

export function configDirectory(env = process.env) {
  const directory = env.HERDR_PLUGIN_CONFIG_DIR;
  if (!directory) {
    throw new PluginError(
      "missing_plugin_config_dir",
      "HERDR_PLUGIN_CONFIG_DIR is not set.",
    );
  }
  return path.resolve(directory);
}

export function loadConfig(options = {}) {
  const directory = options.directory ?? configDirectory(options.env);
  const configPath = path.join(directory, "config.json");
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new PluginError(
      "invalid_config",
      `Could not read ${configPath}: ${error.message}`,
    );
  }
  return validateConfig(parsed);
}
