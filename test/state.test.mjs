import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  mappingForContext,
  pendingStartMatches,
  readState,
  updateState,
  validateState,
} from "../src/state.mjs";
import { remove, temporaryDirectory } from "./helpers.mjs";

test("updateState serializes concurrent local changes", async () => {
  const directory = temporaryDirectory();
  try {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        updateState(
          async (state) => {
            await new Promise((resolve) => setTimeout(resolve, 2));
            state.counter = (state.counter ?? 0) + 1;
            return state;
          },
          { directory },
        ),
      ),
    );
    assert.equal(readState({ directory }).counter, 20);
  } finally {
    remove(directory);
  }
});

test("updateState recovers an abandoned state lock", async () => {
  const directory = temporaryDirectory();
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "state.json.lock"), "invalid\n");
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(path.join(directory, "state.json.lock"), old, old);
    await updateState(
      (state) => {
        state.recovered = true;
        return state;
      },
      { directory, lock: { staleMs: 1_000 } },
    );
    assert.equal(readState({ directory }).recovered, true);
    assert.equal(fs.existsSync(path.join(directory, "state.json.lock")), false);
  } finally {
    remove(directory);
  }
});

test("updateState does not steal a live state lock", async () => {
  const directory = temporaryDirectory();
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "state.json.lock"),
      `${process.pid}\n`,
    );
    await assert.rejects(
      updateState((state) => state, {
        directory,
        lock: { attempts: 2, interval: 1, staleMs: 0 },
      }),
      /Timed out/,
    );
  } finally {
    remove(directory);
  }
});

test("mappingForContext resolves remote panes before paths", () => {
  const state = {
    schemaVersion: 1,
    pendingStarts: {},
    mappings: {
      first: {
        id: "first",
        lifecycleState: "ready",
        sourcePaneId: "source",
        remotePaneId: "remote",
        localRoot: "/repo",
        localCwd: "/repo",
      },
    },
  };
  assert.equal(
    mappingForContext(state, { focused_pane_id: "remote" }).id,
    "first",
  );
  assert.equal(
    mappingForContext(state, { focused_pane_cwd: "/repo" }).id,
    "first",
  );
});

test("mappingForContext uses the configured agent for a shared source pane", () => {
  const state = {
    schemaVersion: 1,
    pendingStarts: {},
    mappings: {
      codex: {
        id: "codex",
        agentKind: "codex",
        lifecycleState: "stopped",
        sourcePaneId: "source",
        remotePaneId: null,
        localRoot: "/repo",
        localCwd: "/repo",
      },
      opencode: {
        id: "opencode",
        agentKind: "opencode",
        lifecycleState: "ready",
        sourcePaneId: "source",
        remotePaneId: "remote",
        localRoot: "/repo",
        localCwd: "/repo",
      },
    },
  };
  assert.equal(
    mappingForContext(
      state,
      { focused_pane_id: "source" },
      {
        agentKind: "opencode",
      },
    ).id,
    "opencode",
  );
  assert.equal(
    mappingForContext(
      state,
      { focused_pane_id: "remote" },
      {
        agentKind: "codex",
      },
    ).id,
    "opencode",
  );
  assert.equal(mappingForContext(state, { focused_pane_id: "source" }), null);
});

test("pendingStartMatches requires the same fresh target and digest", () => {
  const pending = {
    manifestDigest: "abc",
    provisioningFingerprint: "target",
    expiresAt: 1_000,
  };
  assert.equal(pendingStartMatches(pending, "abc", "target", 999), true);
  assert.equal(pendingStartMatches(pending, "def", "target", 999), false);
  assert.equal(pendingStartMatches(pending, "abc", "changed", 999), false);
  assert.equal(pendingStartMatches(pending, "abc", "target", 1_001), false);
});

test("validateState rejects incomplete mappings and pending approvals", () => {
  assert.throws(
    () =>
      validateState({
        schemaVersion: 1,
        mappings: {
          unsafe: { id: "unsafe", lifecycleState: "ready" },
        },
        pendingStarts: {},
      }),
    /Mapping unsafe is invalid/,
  );
  assert.throws(
    () =>
      validateState({
        schemaVersion: 1,
        mappings: {},
        pendingStarts: {
          unsafe: {
            operation: "start",
            manifestDigest: "not-a-digest",
          },
        },
      }),
    /Pending start/,
  );
});
