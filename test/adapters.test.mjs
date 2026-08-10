import assert from "node:assert/strict";
import test from "node:test";

import {
  adapterCapabilities,
  agentInstallCommand,
  getAdapter,
  listAdapters,
} from "../src/adapters.mjs";

test("all built-in adapters pin one package and expected version", () => {
  const adapters = listAdapters();
  assert.deepEqual(
    adapters.map((adapter) => adapter.kind),
    ["codex", "claude-code", "opencode"],
  );
  for (const adapter of adapters) {
    assert.match(adapter.package, /@\d+\.\d+\.\d+$/);
    assert.equal(adapter.package.endsWith(`@${adapter.expectedVersion}`), true);
    assert.equal(adapter.launch.length, 1);
    assert.equal(
      agentInstallCommand(adapter),
      `npm install --global --no-audit --no-fund ${adapter.package}`,
    );
  }
});

test("adapter capabilities keep authentication inside the sandbox", () => {
  for (const adapter of listAdapters()) {
    assert.deepEqual(adapterCapabilities(adapter), {
      interactiveTTY: true,
      persistentSession: true,
      resumeSupported: true,
      authentication: "inside-sandbox",
      hostCredentialCopy: false,
      herdrDetectionKind: adapter.herdrDetectionKind,
    });
  }
  assert.throws(() => getAdapter("unsupported"), /Unsupported agent/);
});
