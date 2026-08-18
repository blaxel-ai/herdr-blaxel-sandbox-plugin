import { getAdapter } from "./adapters.mjs";
import { loadConfig } from "./config.mjs";
import { parsePluginContext } from "./context.mjs";
import { openPluginPane } from "./herdr.mjs";
import { PluginError, emitResult } from "./result.mjs";
import { sandboxInfo } from "./sandbox.mjs";
import { readState, requireMapping } from "./state.mjs";

function contextEnvironment(context) {
  return {
    BLAXEL_HERDR_SOURCE_CONTEXT_JSON: JSON.stringify(context),
  };
}

function mappingFromContext(context) {
  return requireMapping(readState(), context, {
    agentKind: loadConfig().agent,
  });
}

function openMappedOperation(actionId, context, options = {}) {
  const mapping = mappingFromContext(context);
  (options.openPane ?? openPluginPane)("operation", context, {
    placement: "popup",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      BLAXEL_HERDR_OPERATION: actionId,
    },
  });
  return emitResult(actionId, "opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
    pane: "operation",
  });
}

export async function connectBlaxel(context, options = {}) {
  (options.openPane ?? openPluginPane)("blaxel-login", context, {
    placement: "popup",
  });
  return emitResult("connect-blaxel", "opened", { pane: "blaxel-login" });
}

export async function startAgent(context, options = {}) {
  const adapter = getAdapter((options.config ?? loadConfig()).agent);
  (options.openPane ?? openPluginPane)("start", context, {
    placement: "split",
    targetPaneId: context.focused_pane_id,
    env: {
      ...contextEnvironment(context),
      HERDR_AGENT: adapter.herdrDetectionKind,
    },
  });
  return emitResult("start-agent", "opened", { pane: "start" });
}

export async function reconnect(context, options = {}) {
  const mapping = mappingFromContext(context);
  if (["deleting", "deleted"].includes(mapping.lifecycleState)) {
    throw new PluginError(
      "mapping_not_connectable",
      `Mapping ${mapping.id} is ${mapping.lifecycleState}.`,
    );
  }
  const config = loadConfig();
  const adapter = getAdapter(mapping.agentKind);
  const remote = await (options.sandboxInfo ?? sandboxInfo)(mapping);
  if (!remote.exists) {
    throw new PluginError(
      "sandbox_not_found",
      `Sandbox ${mapping.sandboxName} no longer exists. Use Replace.`,
    );
  }
  (options.openPane ?? openPluginPane)("agent", context, {
    placement: "split",
    targetPaneId: mapping.sourcePaneId,
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      HERDR_AGENT: adapter.herdrDetectionKind,
      BL_WORKSPACE: mapping.blaxelWorkspace ?? config.workspace,
    },
  });
  return emitResult("reconnect", "opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export async function applyChanges(context, options = {}) {
  return openMappedOperation("apply-changes", context, options);
}

export async function stop(context, options = {}) {
  return openMappedOperation("stop", context, options);
}

export async function info(context, options = {}) {
  return openMappedOperation("info", context, options);
}

export async function logs(context, options = {}) {
  return openMappedOperation("logs", context, options);
}

export async function previews(context, options = {}) {
  const mapping = mappingFromContext(context);
  (options.openPane ?? openPluginPane)("previews", context, {
    placement: "popup",
    env: { BLAXEL_HERDR_MAPPING_ID: mapping.id },
  });
  return emitResult("previews", "opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export async function dashboard(context, options = {}) {
  (options.openPane ?? openPluginPane)("dashboard", context, {
    placement: "zoomed",
  });
  return emitResult("dashboard", "opened", { pane: "dashboard" });
}

export async function requestDelete(context, options = {}) {
  const mapping = mappingFromContext(context);
  (options.openPane ?? openPluginPane)("confirmation", context, {
    placement: "popup",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      BLAXEL_HERDR_DESTRUCTIVE_ACTION: "delete",
      ...contextEnvironment(context),
    },
  });
  return emitResult("delete-sandbox", "confirmation_opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export async function requestReplace(context, options = {}) {
  const mapping = mappingFromContext(context);
  (options.openPane ?? openPluginPane)("confirmation", context, {
    placement: "popup",
    env: {
      BLAXEL_HERDR_MAPPING_ID: mapping.id,
      BLAXEL_HERDR_DESTRUCTIVE_ACTION: "replace",
      ...contextEnvironment(context),
    },
  });
  return emitResult("replace-sandbox", "confirmation_opened", {
    mappingId: mapping.id,
    sandboxName: mapping.sandboxName,
  });
}

export const ACTIONS = Object.freeze({
  "connect-blaxel": connectBlaxel,
  "start-agent": startAgent,
  reconnect,
  "apply-changes": applyChanges,
  stop,
  info,
  logs,
  previews,
  dashboard,
  "replace-sandbox": requestReplace,
  "delete-sandbox": requestDelete,
});

export async function runAction(actionId = process.env.HERDR_PLUGIN_ACTION_ID) {
  const action = ACTIONS[actionId];
  if (!action) {
    throw new PluginError(
      "unknown_action",
      `Unknown action: ${actionId || "<missing>"}.`,
    );
  }
  return action(parsePluginContext());
}
