import fs from "node:fs";
import path from "node:path";

import { runSync } from "./process.mjs";
import { PluginError } from "./result.mjs";

export function parsePluginContext(
  raw = process.env.HERDR_PLUGIN_CONTEXT_JSON,
) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("context must be an object");
    }
    return parsed;
  } catch (error) {
    throw new PluginError(
      "invalid_herdr_context",
      `HERDR_PLUGIN_CONTEXT_JSON is invalid: ${error.message}`,
    );
  }
}

export function contextCwd(context, fallback = process.cwd()) {
  return (
    context.focused_pane_cwd ??
    context.worktree?.checkout_path ??
    context.workspace_cwd ??
    fallback
  );
}

export function resolveGitContext(context, options = {}) {
  const requestedCwd = path.resolve(contextCwd(context, options.cwd));
  const cwd = fs.realpathSync.native(requestedCwd);
  const rootResult = runSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    check: false,
  });
  if (rootResult.status !== 0) {
    throw new PluginError(
      "git_worktree_required",
      `No Git worktree contains ${cwd}.`,
    );
  }
  const root = fs.realpathSync.native(path.resolve(rootResult.stdout.trim()));
  const relativeCwd = path.relative(root, cwd) || ".";
  if (relativeCwd === ".." || relativeCwd.startsWith(`..${path.sep}`)) {
    throw new PluginError(
      "invalid_worktree_context",
      `${cwd} is outside ${root}.`,
    );
  }
  return {
    root,
    cwd,
    relativeCwd: relativeCwd.split(path.sep).join("/"),
    sourcePaneId: context.focused_pane_id ?? process.env.HERDR_PANE_ID ?? null,
  };
}
