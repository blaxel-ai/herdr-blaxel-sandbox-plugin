import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { startAgent } from "../src/actions.mjs";
import { PluginError } from "../src/result.mjs";
import { readState } from "../src/state.mjs";
import {
  makeGitRepository,
  remove,
  temporaryDirectory,
  write,
} from "./helpers.mjs";

test("the first start invocation stores only a target-and-digest-bound approval", async () => {
  const root = makeGitRepository();
  const configDirectory = temporaryDirectory();
  const stateDirectory = temporaryDirectory();
  const previous = {
    config: process.env.HERDR_PLUGIN_CONFIG_DIR,
    state: process.env.HERDR_PLUGIN_STATE_DIR,
  };
  try {
    write(root, "README.md", "hello\n");
    fs.writeFileSync(
      path.join(configDirectory, "config.json"),
      JSON.stringify({ workspace: "test-workspace" }),
    );
    process.env.HERDR_PLUGIN_CONFIG_DIR = configDirectory;
    process.env.HERDR_PLUGIN_STATE_DIR = stateDirectory;
    const result = await startAgent({
      focused_pane_cwd: root,
      focused_pane_id: "pane-1",
      workspace_id: "workspace-1",
    });
    assert.equal(result.status, "needs_upload_approval");
    const state = readState({ directory: stateDirectory });
    assert.equal(Object.keys(state.mappings).length, 0);
    const pending = Object.values(state.pendingStarts);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].manifestDigest, result.manifestDigest);
    fs.writeFileSync(path.join(root, "README.md"), "changed\n");
    const changed = await startAgent({
      focused_pane_cwd: root,
      focused_pane_id: "pane-1",
      workspace_id: "workspace-1",
    });
    assert.equal(changed.status, "needs_upload_approval");
    assert.notEqual(changed.manifestDigest, result.manifestDigest);
    assert.equal(
      Object.keys(readState({ directory: stateDirectory }).mappings).length,
      0,
    );
  } finally {
    if (previous.config === undefined)
      delete process.env.HERDR_PLUGIN_CONFIG_DIR;
    else process.env.HERDR_PLUGIN_CONFIG_DIR = previous.config;
    if (previous.state === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = previous.state;
    remove(root);
    remove(configDirectory);
    remove(stateDirectory);
  }
});

test("start opens Blaxel login only when onboarding is required", async () => {
  const configDirectory = temporaryDirectory();
  const stateDirectory = temporaryDirectory();
  const previous = {
    config: process.env.HERDR_PLUGIN_CONFIG_DIR,
    state: process.env.HERDR_PLUGIN_STATE_DIR,
  };
  const opened = [];
  try {
    process.env.HERDR_PLUGIN_CONFIG_DIR = configDirectory;
    process.env.HERDR_PLUGIN_STATE_DIR = stateDirectory;
    const result = await startAgent(
      { focused_pane_id: "pane-1", workspace_id: "workspace-1" },
      {
        resolveWorkspace: () => {
          throw new PluginError("blaxel_login_required", "Sign in to Blaxel.");
        },
        openPane: (...args) => opened.push(args),
      },
    );
    assert.equal(result.status, "needs_blaxel_login");
    assert.equal(opened.length, 1);
    assert.equal(opened[0][0], "blaxel-login");
    assert.equal(
      Object.keys(readState({ directory: stateDirectory }).mappings).length,
      0,
    );
    assert.equal(
      Object.keys(readState({ directory: stateDirectory }).pendingStarts)
        .length,
      0,
    );
  } finally {
    if (previous.config === undefined)
      delete process.env.HERDR_PLUGIN_CONFIG_DIR;
    else process.env.HERDR_PLUGIN_CONFIG_DIR = previous.config;
    if (previous.state === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = previous.state;
    remove(configDirectory);
    remove(stateDirectory);
  }
});
