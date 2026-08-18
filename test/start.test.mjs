import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.mjs";
import { prepareStart, provisionStart } from "../src/start.mjs";
import { readState } from "../src/state.mjs";
import {
  makeGitRepository,
  remove,
  temporaryDirectory,
  write,
} from "./helpers.mjs";

function fakeProvision() {
  return async ({ onLifecycle }) => {
    await onLifecycle("creating");
    await onLifecycle("uploading");
    await onLifecycle("preparing");
    return {
      baselineCommit: "b".repeat(40),
      installedVersion: "0.147.0",
      capabilities: { persistentSession: true },
    };
  };
}

function startOptions() {
  return {
    config: { ...DEFAULT_CONFIG, workspace: "test-workspace" },
    resolveWorkspace: () => "test-workspace",
  };
}

test("one start provisions without persistent pending state", async () => {
  const root = makeGitRepository();
  const stateDirectory = temporaryDirectory();
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  try {
    write(root, "README.md", "hello\n");
    process.env.HERDR_PLUGIN_STATE_DIR = stateDirectory;
    const context = {
      focused_pane_cwd: root,
      focused_pane_id: "pane-1",
    };
    const prepared = prepareStart(context, startOptions());
    const result = await provisionStart(prepared, {
      ...startOptions(),
      provision: fakeProvision(),
    });
    assert.equal(result.mapping.lifecycleState, "ready");
    assert.equal(result.mapping.sourcePaneId, "pane-1");
    assert.equal(Object.keys(readState().mappings).length, 1);
  } finally {
    if (previous === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = previous;
    remove(root);
    remove(stateDirectory);
  }
});

test("an upload change during Start prevents the first remote write", async () => {
  const root = makeGitRepository();
  const stateDirectory = temporaryDirectory();
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  let provisioned = false;
  try {
    const file = write(root, "README.md", "hello\n");
    process.env.HERDR_PLUGIN_STATE_DIR = stateDirectory;
    const prepared = prepareStart(
      { focused_pane_cwd: root, focused_pane_id: "pane-1" },
      startOptions(),
    );
    fs.writeFileSync(file, "changed\n");
    await assert.rejects(
      provisionStart(prepared, {
        ...startOptions(),
        provision: async () => {
          provisioned = true;
        },
      }),
      (error) => error.code === "start_snapshot_changed",
    );
    assert.equal(provisioned, false);
    assert.equal(Object.keys(readState().mappings).length, 0);
  } finally {
    if (previous === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = previous;
    remove(root);
    remove(stateDirectory);
  }
});

test("repeated starts from one source pane receive independent Sandbox mappings", async () => {
  const root = makeGitRepository();
  const stateDirectory = temporaryDirectory();
  const previous = process.env.HERDR_PLUGIN_STATE_DIR;
  try {
    write(root, "README.md", "hello\n");
    process.env.HERDR_PLUGIN_STATE_DIR = stateDirectory;
    for (const paneId of ["pane-1", "pane-1"]) {
      const prepared = prepareStart(
        { focused_pane_cwd: root, focused_pane_id: paneId },
        startOptions(),
      );
      await provisionStart(prepared, {
        ...startOptions(),
        provision: fakeProvision(),
      });
    }
    const mappings = Object.values(readState().mappings);
    assert.equal(mappings.length, 2);
    assert.notEqual(mappings[0].sandboxName, mappings[1].sandboxName);
    assert.equal(
      mappings.every(({ sourcePaneId }) => sourcePaneId === "pane-1"),
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = previous;
    remove(root);
    remove(stateDirectory);
  }
});
