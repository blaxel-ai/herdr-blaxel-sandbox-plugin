export const PLUGIN_ID = "blaxel.sandbox";
export const STATE_SCHEMA_VERSION = 1;
export const MAPPING_SCHEMA_VERSION = 1;
export const DEFAULT_REMOTE_ROOT = "/workspace";
export const DEFAULT_SHELL_PATH = "/usr/local/bin/herdr-blaxel-shell";
export const DEFAULT_INTERACTIVE_ENV_PATH =
  "/usr/local/bin/herdr-blaxel-interactive-env";
export const DEFAULT_IMAGE = "blaxel/ts-app:latest";
export const DEFAULT_MEMORY_MB = 4096;
export const DEFAULT_IDLE_DELETE = "7d";
export const MAX_SANDBOX_NAME_LENGTH = 49;

export const LIFECYCLE_STATES = new Set([
  "provisional",
  "creating",
  "uploading",
  "preparing",
  "ready",
  "connected",
  "stopped",
  "missing",
  "deleting",
  "deleted",
  "failed",
]);
