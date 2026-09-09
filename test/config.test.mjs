import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, loadConfig, validateConfig } from "../src/config.mjs";
import { remove, temporaryDirectory } from "./helpers.mjs";

test("loadConfig returns safe defaults when config.json is absent", () => {
  const directory = temporaryDirectory();
  try {
    assert.deepEqual(loadConfig({ directory }), DEFAULT_CONFIG);
  } finally {
    remove(directory);
  }
});

test("validateConfig rejects unknown keys and unsafe shapes", () => {
  assert.throws(
    () => validateConfig({ typoAgent: "codex" }),
    /Unknown config keys/,
  );
  assert.throws(
    () => validateConfig({ agent: "unknown" }),
    /agent must be one of/,
  );
  assert.throws(
    () => validateConfig({ remoteRoot: "workspace" }),
    /absolute POSIX path/,
  );
  assert.throws(
    () => validateConfig({ remoteRoot: "/" }),
    /must be \/workspace/,
  );
  assert.throws(
    () => validateConfig({ remoteRoot: "/workspace/../etc" }),
    /must be \/workspace/,
  );
  assert.throws(
    () => validateConfig({ previewPorts: [3000, 3000] }),
    /duplicates/,
  );
  assert.throws(
    () => validateConfig({ allowSensitivePaths: ["ok", 42] }),
    /non-empty strings/,
  );
  assert.throws(
    () => validateConfig({ allowSensitivePaths: ["../credentials.json"] }),
    /safe paths/,
  );
  assert.throws(
    () => validateConfig({ allowSensitivePaths: ["config/"] }),
    /safe paths/,
  );
  assert.throws(
    () => validateConfig({ excludedPaths: ["dist/**"] }),
    /safe paths/,
  );
  assert.throws(
    () => validateConfig({ excludedPaths: ["tmp/", "tmp/"] }),
    /duplicates/,
  );
  assert.throws(
    () => validateConfig({ idleDelete: "one week" }),
    /number followed by/,
  );
  assert.throws(
    () => validateConfig({ sandboxNamePrefix: "---" }),
    /letter or number/,
  );
  assert.throws(
    () => validateConfig({ uploadApprovalSeconds: 600 }),
    /Unknown config/,
  );
  assert.throws(
    () => validateConfig({ agentArgs: ["--model", 42] }),
    /non-empty strings/,
  );
  assert.throws(() => validateConfig({ autoApprove: true }), /Unknown config/);
});

test("validateConfig accepts safe exact paths and excluded directories", () => {
  const config = validateConfig({
    allowSensitivePaths: ["fixtures/example.env"],
    excludedPaths: ["dist/", "generated/output.json"],
    idleDelete: "12h",
    remoteRoot: "/workspace/packages/app",
    agentArgs: ["--model", "gpt-5.6-terra"],
  });
  assert.deepEqual(config.allowSensitivePaths, ["fixtures/example.env"]);
  assert.deepEqual(config.excludedPaths, ["dist/", "generated/output.json"]);
  assert.equal(config.remoteRoot, "/workspace/packages/app");
  assert.deepEqual(config.agentArgs, ["--model", "gpt-5.6-terra"]);
});

test("loadConfig reads a strict user configuration", () => {
  const directory = temporaryDirectory();
  try {
    fs.writeFileSync(
      path.join(directory, "config.json"),
      JSON.stringify({
        agent: "opencode",
        previewPorts: [4321],
        publicPreviews: true,
      }),
    );
    const config = loadConfig({ directory });
    assert.equal(config.agent, "opencode");
    assert.deepEqual(config.previewPorts, [4321]);
    assert.equal(config.publicPreviews, true);
    assert.equal(config.image, DEFAULT_CONFIG.image);
  } finally {
    remove(directory);
  }
});

test("saveConfig persists Pi and advanced settings with private file permissions", async () => {
  const { saveConfig } = await import("../src/config.mjs");
  const directory = temporaryDirectory();
  try {
    const config = saveConfig(
      {
        agent: "pi",
        workspace: "test",
        previewPorts: [4321],
        excludedPaths: ["generated/"],
      },
      { directory },
    );
    assert.deepEqual(loadConfig({ directory }), config);
    assert.equal(
      fs.statSync(path.join(directory, "config.json")).mode & 0o777,
      0o600,
    );
    assert.throws(
      () => saveConfig({ agent: "invalid" }, { directory }),
      /agent must be/,
    );
    assert.deepEqual(loadConfig({ directory }), config);
    assert.deepEqual(fs.readdirSync(directory), ["config.json"]);
  } finally {
    remove(directory);
  }
});
