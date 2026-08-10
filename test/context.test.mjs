import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parsePluginContext, resolveGitContext } from "../src/context.mjs";
import { makeGitRepository, remove, write } from "./helpers.mjs";

test("parsePluginContext accepts the Herdr context object", () => {
  assert.deepEqual(parsePluginContext('{"workspace_id":"workspace-1"}'), {
    workspace_id: "workspace-1",
  });
  assert.throws(() => parsePluginContext("[]"), /context must be an object/);
  assert.throws(() => parsePluginContext("{"), /is invalid/);
});

test("resolveGitContext finds the worktree root and relative cwd", () => {
  const root = makeGitRepository();
  try {
    write(root, "packages/app/file.txt", "hello");
    const cwd = path.join(root, "packages/app");
    const context = resolveGitContext({
      focused_pane_cwd: cwd,
      focused_pane_id: "pane-1",
      workspace_id: "workspace-1",
    });
    assert.equal(context.root, fs.realpathSync.native(root));
    assert.equal(context.cwd, fs.realpathSync.native(cwd));
    assert.equal(context.relativeCwd, "packages/app");
    assert.equal(context.sourcePaneId, "pane-1");
  } finally {
    remove(root);
  }
});
