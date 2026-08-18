import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  applyChanges,
  connectBlaxel,
  dashboard,
  info,
  logs,
  previews,
  reconnect,
  requestDelete,
  requestReplace,
  startAgent,
  stop,
} from "../src/actions.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { updateState } from "../src/state.mjs";
import { remove, temporaryDirectory } from "./helpers.mjs";

function mapping(root) {
  const at = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: "12345678-1234-4123-8123-123456789abc",
    agentKind: "codex",
    sourcePaneId: "pane-1",
    remotePaneId: null,
    blaxelWorkspace: "test-workspace",
    sandboxName: "herdr-codex-test-1234",
    localRoot: root,
    localCwd: root,
    relativeCwd: ".",
    remoteRoot: "/workspace",
    lifecycleState: "ready",
    uploadManifestDigest: "a".repeat(64),
    lastAppliedExportCommit: "b".repeat(40),
    installedVersion: "0.147.0",
    capabilities: {},
    createdAt: at,
    updatedAt: at,
  };
}

test("start and connect immediately open visible interactive panes", async () => {
  const opened = [];
  const context = {
    focused_pane_cwd: "/repo",
    focused_pane_id: "pane-1",
    workspace_id: "workspace-1",
  };
  const start = await startAgent(context, {
    openPane: (...args) => opened.push(args),
    config: DEFAULT_CONFIG,
  });
  const connect = await connectBlaxel(context, {
    openPane: (...args) => opened.push(args),
  });
  assert.equal(start.status, "opened");
  assert.equal(connect.status, "opened");
  assert.equal(opened[0][0], "start");
  assert.equal(opened[0][2].placement, "split");
  assert.equal(opened[0][2].targetPaneId, "pane-1");
  assert.equal(opened[0][2].env.HERDR_AGENT, "codex");
  assert.deepEqual(
    JSON.parse(opened[0][2].env.BLAXEL_HERDR_SOURCE_CONTEXT_JSON),
    context,
  );
  assert.equal(opened[1][0], "blaxel-login");
});

test("every mapped lifecycle action opens its human-facing pane", async () => {
  const configDirectory = temporaryDirectory();
  const stateDirectory = temporaryDirectory();
  const root = temporaryDirectory();
  const previous = {
    config: process.env.HERDR_PLUGIN_CONFIG_DIR,
    state: process.env.HERDR_PLUGIN_STATE_DIR,
  };
  const opened = [];
  const context = { focused_pane_cwd: root, focused_pane_id: "pane-1" };
  const options = { openPane: (...args) => opened.push(args) };
  try {
    fs.writeFileSync(
      path.join(configDirectory, "config.json"),
      JSON.stringify({ agent: "codex" }),
    );
    process.env.HERDR_PLUGIN_CONFIG_DIR = configDirectory;
    process.env.HERDR_PLUGIN_STATE_DIR = stateDirectory;
    const item = mapping(root);
    await updateState((state) => {
      state.mappings[item.id] = item;
      return state;
    });
    await applyChanges(context, options);
    await stop(context, options);
    await info(context, options);
    await logs(context, options);
    await previews(context, options);
    await requestReplace(context, options);
    await requestDelete(context, options);
    await dashboard(context, options);
    await reconnect(context, {
      ...options,
      sandboxInfo: async () => ({ exists: true }),
    });

    assert.deepEqual(
      opened.map(([pane]) => pane),
      [
        "operation",
        "operation",
        "operation",
        "operation",
        "previews",
        "confirmation",
        "confirmation",
        "dashboard",
        "agent",
      ],
    );
    assert.deepEqual(
      opened
        .slice(0, 4)
        .map(([, , paneOptions]) => paneOptions.env.BLAXEL_HERDR_OPERATION),
      ["apply-changes", "stop", "info", "logs"],
    );
    assert.equal(opened[5][2].env.BLAXEL_HERDR_DESTRUCTIVE_ACTION, "replace");
    assert.equal(opened[6][2].env.BLAXEL_HERDR_DESTRUCTIVE_ACTION, "delete");
  } finally {
    if (previous.config === undefined)
      delete process.env.HERDR_PLUGIN_CONFIG_DIR;
    else process.env.HERDR_PLUGIN_CONFIG_DIR = previous.config;
    if (previous.state === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = previous.state;
    remove(configDirectory);
    remove(stateDirectory);
    remove(root);
  }
});
