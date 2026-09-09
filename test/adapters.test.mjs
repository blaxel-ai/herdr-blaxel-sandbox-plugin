import assert from "node:assert/strict";
import test from "node:test";

import {
  adapterCapabilities,
  adapterSecretEnvironment,
  agentAuthenticationCommand,
  agentInstallCommand,
  getAdapter,
  listAdapters,
} from "../src/adapters.mjs";

test("all built-in adapters pin one package and expected version", () => {
  const adapters = listAdapters();
  assert.deepEqual(
    adapters.map((adapter) => adapter.kind),
    ["codex", "claude-code", "opencode", "pi"],
  );
  for (const adapter of adapters) {
    assert.match(adapter.package, /@\d+\.\d+\.\d+$/);
    assert.equal(adapter.package.endsWith(`@${adapter.expectedVersion}`), true);
    assert.equal(adapter.launch.length, 1);
    assert.equal(
      agentInstallCommand(adapter),
      adapter.kind === "pi"
        ? "npm install --global --no-audit --no-fund --before='2026-09-09T18:00:00Z' @mariozechner/pi-coding-agent@0.73.1"
        : `npm install --global --no-audit --no-fund ${adapter.package}`,
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
      secretEnvironment: [],
      herdrDetectionKind: adapter.herdrDetectionKind,
    });
  }
  assert.throws(() => getAdapter("unsupported"), /Unsupported agent/);
});

test("adapters expose only present provider keys as encrypted environment", () => {
  assert.deepEqual(
    adapterSecretEnvironment(getAdapter("codex"), {
      OPENAI_API_KEY: "test-key",
      ANTHROPIC_API_KEY: "not-for-codex",
    }),
    [{ name: "OPENAI_API_KEY", value: "test-key", secret: true }],
  );
  assert.deepEqual(adapterSecretEnvironment(getAdapter("claude-code"), {}), []);
  assert.deepEqual(
    adapterSecretEnvironment(getAdapter("opencode"), {
      OPENAI_API_KEY: "test-key",
      UNRELATED_API_KEY: "not-for-opencode",
    }),
    [{ name: "OPENAI_API_KEY", value: "test-key", secret: true }],
  );
  assert.match(
    agentAuthenticationCommand(getAdapter("codex"), ["OPENAI_API_KEY"]),
    /codex login --with-api-key/,
  );
  assert.equal(
    agentAuthenticationCommand(getAdapter("opencode"), ["OPENAI_API_KEY"]),
    null,
  );
});
