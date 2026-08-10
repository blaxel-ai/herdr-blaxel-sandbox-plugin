import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.mjs";
import { getAdapter } from "../src/adapters.mjs";
import {
  approvalFingerprint,
  buildUploadManifest,
  formatManifest,
  pathExclusionReason,
} from "../src/manifest.mjs";
import { runSync } from "../src/process.mjs";
import { makeGitRepository, remove, write } from "./helpers.mjs";

test("pathExclusionReason blocks credentials and accepts exact overrides", () => {
  const config = { ...DEFAULT_CONFIG, allowSensitivePaths: [] };
  assert.equal(pathExclusionReason(".env", config), "environment-file");
  assert.equal(pathExclusionReason("nested/id_rsa", config), "credential-file");
  assert.equal(pathExclusionReason("src/index.mjs", config), null);
  assert.equal(
    pathExclusionReason(".env", { ...config, allowSensitivePaths: [".env"] }),
    null,
  );
  assert.equal(
    pathExclusionReason("node_modules/tool/token.json", {
      ...config,
      allowSensitivePaths: ["node_modules/tool/token.json"],
    }),
    "blocked-directory",
  );
});

test("buildUploadManifest includes safe files and excludes tracked secrets", () => {
  const root = makeGitRepository();
  try {
    write(root, "src/index.mjs", "console.log('safe')\n", 0o755);
    write(root, ".env", "TOKEN=secret\n");
    write(root, "private.txt", "-----BEGIN PRIVATE KEY-----\nsecret\n");
    write(root, ".env.example", "TOKEN=replace-me\n");
    write(root, "untracked.txt", "included\n");
    runSync("git", ["add", "src/index.mjs", ".env.example", "private.txt"], {
      cwd: root,
    });
    runSync("git", ["add", "-f", ".env"], { cwd: root });
    const manifest = buildUploadManifest(root, DEFAULT_CONFIG);
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      [".env.example", "src/index.mjs", "untracked.txt"],
    );
    assert.equal(
      manifest.files.find((file) => file.path === "src/index.mjs").executable,
      true,
    );
    assert.deepEqual(
      manifest.excluded.map((file) => [file.path, file.reason]),
      [
        [".env", "environment-file"],
        ["private.txt", "detected-secret"],
      ],
    );
    assert.match(formatManifest(manifest), new RegExp(manifest.digest));
    const before = manifest.digest;
    fs.writeFileSync(`${root}/untracked.txt`, "changed\n");
    assert.notEqual(buildUploadManifest(root, DEFAULT_CONFIG).digest, before);
  } finally {
    remove(root);
  }
});

test("buildUploadManifest enforces file and total size limits", () => {
  const root = makeGitRepository();
  try {
    write(root, "large.txt", "12345");
    assert.throws(
      () => buildUploadManifest(root, { ...DEFAULT_CONFIG, maxFileBytes: 4 }),
      /per-file limit/,
    );
    assert.throws(
      () => buildUploadManifest(root, { ...DEFAULT_CONFIG, maxUploadBytes: 4 }),
      /filtered upload exceeds/,
    );
  } finally {
    remove(root);
  }
});

test("buildUploadManifest scans the complete allowed text file for secrets", () => {
  const root = makeGitRepository();
  try {
    write(
      root,
      "late-secret.txt",
      `${"safe\n".repeat(220_000)}sk-proj-abcdefghijklmnopqrstuvwxyz123456\n`,
    );
    const manifest = buildUploadManifest(root, DEFAULT_CONFIG);
    assert.deepEqual(manifest.files, []);
    assert.deepEqual(manifest.excluded, [
      { path: "late-secret.txt", reason: "detected-secret" },
    ]);
  } finally {
    remove(root);
  }
});

test("approvalFingerprint changes with the provisioning target", () => {
  const adapter = getAdapter("codex");
  const first = approvalFingerprint({
    config: DEFAULT_CONFIG,
    adapter,
    workspace: "main",
  });
  assert.equal(
    first,
    approvalFingerprint({
      config: DEFAULT_CONFIG,
      adapter,
      workspace: "main",
    }),
  );
  assert.notEqual(
    first,
    approvalFingerprint({
      config: { ...DEFAULT_CONFIG, publicPreviews: true },
      adapter,
      workspace: "main",
    }),
  );
  assert.notEqual(
    first,
    approvalFingerprint({
      config: DEFAULT_CONFIG,
      adapter,
      workspace: "another-workspace",
    }),
  );
});

test("formatManifest shows the exact visible target and approval window", () => {
  const output = formatManifest(
    {
      files: [],
      excluded: [],
      totalBytes: 0,
      digest: "a".repeat(64),
    },
    {
      target: {
        sandboxName: "herdr-codex-example",
        workspace: "workspace-1",
        agent: "Codex 0.147.0",
        image: "blaxel/ts-app:latest",
        region: "us-pdx-1",
        memory: 4096,
        remoteRoot: "/workspace",
        idleDelete: "1h",
        previewPorts: [3000, 5173],
        publicPreviews: false,
      },
      approvalSeconds: 90,
    },
  );
  assert.match(output, /Sandbox: herdr-codex-example/);
  assert.match(output, /Remote root: \/workspace/);
  assert.match(output, /Previews: private on 3000, 5173/);
  assert.match(output, /within 90 seconds/);
});
