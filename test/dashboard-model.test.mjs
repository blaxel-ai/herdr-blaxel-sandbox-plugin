import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAge,
  missingMappingsToPrune,
  repositoryInfo,
} from "../src/dashboard-model.mjs";

test("formatAge keeps dashboard age labels compact", () => {
  const now = Date.parse("2026-08-18T12:00:00Z");
  assert.equal(formatAge("2026-08-18T11:59:50Z", now), "now");
  assert.equal(formatAge("2026-08-18T11:30:00Z", now), "30m");
  assert.equal(formatAge("2026-08-18T09:00:00Z", now), "3h");
  assert.equal(formatAge("2026-08-15T12:00:00Z", now), "3d");
});

test("repositoryInfo presents repository and branch without changing state", () => {
  const calls = [];
  const info = repositoryInfo(
    { localRoot: "/work/example", localCwd: "/work/example/packages/app" },
    {
      runCommand: (...args) => {
        calls.push(args);
        return { status: 0, stdout: "feature/dashboard\n" };
      },
    },
  );
  assert.deepEqual(info, {
    name: "example",
    branch: "feature/dashboard",
    path: "/work/example",
    cwd: "/work/example/packages/app",
  });
  assert.deepEqual(calls[0].slice(0, 2), ["git", ["branch", "--show-current"]]);
});

test("missing mappings require three confirmed refreshes before pruning", () => {
  const mapping = { id: "mapping-1" };
  const cache = new Map([[mapping.id, { exists: false, status: "MISSING" }]]);
  const counts = new Map();
  assert.deepEqual(missingMappingsToPrune([mapping], cache, counts), []);
  assert.deepEqual(missingMappingsToPrune([mapping], cache, counts), []);
  assert.deepEqual(missingMappingsToPrune([mapping], cache, counts), [
    mapping.id,
  ]);
  cache.set(mapping.id, { exists: true, status: "DEPLOYED" });
  assert.deepEqual(missingMappingsToPrune([mapping], cache, counts), []);
  assert.equal(counts.has(mapping.id), false);
});
