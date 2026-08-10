import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { exportAndApplyPatch } from "../src/patch.mjs";
import { runSync } from "../src/process.mjs";
import { makeGitRepository, remove, write } from "./helpers.mjs";

function fakeSandbox(patch) {
  return {
    process: {
      exec: async () => ({
        status: "completed",
        stdout: "a".repeat(40),
        exitCode: 0,
      }),
    },
    fs: {
      readBinary: async () => new Blob([patch]),
    },
  };
}

function mapping(root) {
  return {
    id: "mapping-1",
    sandboxName: "sandbox-1",
    blaxelWorkspace: "workspace-1",
    localRoot: root,
    remoteRoot: "/workspace",
    lastAppliedExportCommit: "b".repeat(40),
  };
}

test("exportAndApplyPatch checks and applies a binary Git patch", async () => {
  const root = makeGitRepository();
  try {
    write(root, "file.txt", "before\n");
    runSync("git", ["add", "file.txt"], { cwd: root });
    runSync("git", ["commit", "-q", "-m", "baseline"], { cwd: root });
    write(root, "file.txt", "after\n");
    const patch = runSync("git", ["diff", "--binary", "HEAD"], {
      cwd: root,
    }).stdout;
    runSync("git", ["restore", "file.txt"], { cwd: root });
    const lookups = [];
    const getSandbox = async (...args) => {
      lookups.push(args);
      return fakeSandbox(patch);
    };
    const result = await exportAndApplyPatch(mapping(root), { getSandbox });
    assert.equal(result.status, "applied");
    assert.equal(fs.readFileSync(`${root}/file.txt`, "utf8"), "after\n");
    const repeated = await exportAndApplyPatch(mapping(root), { getSandbox });
    assert.equal(repeated.status, "already_applied");
    assert.deepEqual(lookups, [
      ["sandbox-1", "workspace-1"],
      ["sandbox-1", "workspace-1"],
    ]);
  } finally {
    remove(root);
  }
});

test("exportAndApplyPatch refuses a conflicting local tree", async () => {
  const root = makeGitRepository();
  try {
    write(root, "file.txt", "before\n");
    runSync("git", ["add", "file.txt"], { cwd: root });
    runSync("git", ["commit", "-q", "-m", "baseline"], { cwd: root });
    write(root, "file.txt", "after\n");
    const patch = runSync("git", ["diff", "--binary", "HEAD"], {
      cwd: root,
    }).stdout;
    write(root, "file.txt", "local conflict\n");
    await assert.rejects(
      exportAndApplyPatch(mapping(root), {
        getSandbox: async () => fakeSandbox(patch),
      }),
      (error) => error.code === "patch_conflict",
    );
  } finally {
    remove(root);
  }
});
