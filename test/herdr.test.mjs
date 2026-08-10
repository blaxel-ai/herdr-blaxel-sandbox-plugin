import assert from "node:assert/strict";
import test from "node:test";

import { pluginPaneArgs } from "../src/herdr.mjs";

const context = { workspace_id: "w1", focused_pane_id: "w1:p1" };

test("split and zoomed panes target a pane without a workspace", () => {
  for (const placement of ["split", "zoomed"]) {
    const args = pluginPaneArgs("agent", context, { placement });
    assert.deepEqual(args.slice(-5), [
      "--placement",
      placement,
      "--target-pane",
      "w1:p1",
      "--focus",
    ]);
    assert.ok(!args.includes("--workspace"));
  }
});

test("popup panes use the active pane without explicit targets", () => {
  const args = pluginPaneArgs("previews", context, { placement: "popup" });
  assert.ok(!args.includes("--workspace"));
  assert.ok(!args.includes("--target-pane"));
});

test("tab panes use the workspace without a target pane", () => {
  const args = pluginPaneArgs("tab", context, { placement: "tab" });
  assert.ok(args.includes("--workspace"));
  assert.ok(!args.includes("--target-pane"));
});
