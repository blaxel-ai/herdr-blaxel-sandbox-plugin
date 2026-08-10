import { PLUGIN_ID } from "./constants.mjs";
import { runSync } from "./process.mjs";
import { PluginError } from "./result.mjs";

export function herdrBinary(env = process.env) {
  return env.HERDR_BIN_PATH || "herdr";
}

export function pluginPaneArgs(entrypoint, context, options = {}) {
  const args = [
    "plugin",
    "pane",
    "open",
    "--plugin",
    PLUGIN_ID,
    "--entrypoint",
    entrypoint,
  ];
  const placement = options.placement;
  if (placement) args.push("--placement", placement);
  if (placement === "tab" && (options.workspaceId ?? context.workspace_id)) {
    args.push("--workspace", options.workspaceId ?? context.workspace_id);
  }
  if (
    ["split", "zoomed"].includes(placement) &&
    (options.targetPaneId ?? context.focused_pane_id)
  ) {
    args.push("--target-pane", options.targetPaneId ?? context.focused_pane_id);
  }
  if (options.cwd) args.push("--cwd", options.cwd);
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new PluginError(
        "invalid_pane_env",
        `Invalid pane environment key: ${key}.`,
      );
    }
    args.push("--env", `${key}=${value}`);
  }
  args.push(options.focus === false ? "--no-focus" : "--focus");
  return args;
}

export function openPluginPane(entrypoint, context, options = {}) {
  const args = pluginPaneArgs(entrypoint, context, options);
  return runSync(herdrBinary(options.processEnv), args, {
    env: options.processEnv,
  });
}

export function closePluginPane(paneId, options = {}) {
  return runSync(
    herdrBinary(options.processEnv),
    ["plugin", "pane", "close", paneId],
    {
      env: options.processEnv,
      check: options.check,
    },
  );
}
