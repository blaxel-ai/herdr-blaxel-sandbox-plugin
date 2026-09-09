import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEFAULT_CONFIG } from "../src/config.mjs";
import { getAdapter } from "../src/adapters.mjs";
import {
  captureAgentOutput,
  deleteSandbox,
  discoverPreviews,
  interactiveShellBootstrap,
  provisionSandbox,
  remoteWorkingDirectory,
  resolveBlaxelWorkspace,
  sandboxInfo,
  sandboxNameFor,
  shellQuote,
  stopAgent,
  terminalWrapper,
} from "../src/sandbox.mjs";
import { remove, temporaryDirectory, write } from "./helpers.mjs";

function testMapping() {
  return {
    id: "12345678-1234-4123-8123-123456789abc",
    sandboxName: "herdr-codex-test-1234",
    agentKind: "codex",
    remoteRoot: "/workspace",
  };
}

test("sandboxNameFor is stable, scoped, and within Blaxel's name limit", () => {
  const input = {
    prefix: "Herdr",
    agentKind: "claude-code",
    localRoot: "/a/Very Long Repository Name With Spaces",
    sourcePaneId: "pane-1",
  };
  const first = sandboxNameFor(input);
  assert.equal(first, sandboxNameFor(input));
  assert.match(first, /^[a-z0-9-]+$/);
  assert.ok(first.length <= 49);
  assert.notEqual(first, sandboxNameFor({ ...input, sourcePaneId: "pane-2" }));
  assert.notEqual(
    first,
    sandboxNameFor({ ...input, instanceId: "another-sandbox" }),
  );

  const repositoryName = sandboxNameFor({
    prefix: "herdr-demo",
    agentKind: "opencode",
    localRoot: "/a/herdr-blaxel-sandbox-plugin",
    sourcePaneId: "pane-1",
  });
  assert.ok(repositoryName.length <= 49);
  assert.match(repositoryName, /-[0-9a-f]{10}$/);
});

test("the safe shell bootstraps the persistent wrapper only for interactive connections", () => {
  assert.equal(
    interactiveShellBootstrap(),
    "exec '/usr/local/bin/herdr-blaxel-shell'\n",
  );
});

test("truncation never leaves consecutive hyphens in a Sandbox name", () => {
  for (const prefix of ["herdr-maint-09", "herdr"]) {
    const name = sandboxNameFor({
      prefix,
      agentKind: "claude-code",
      localRoot: "/a/invoice-summary-with-a-long-name",
      sourcePaneId: "w1:p1",
    });
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(name.length <= 49);
    assert.match(name, /-[0-9a-f]{10}$/);
  }
});

test("terminalWrapper starts the configured adapter through one tmux session", () => {
  const wrapper = terminalWrapper(
    {
      id: "1234567890abcdef",
      agentKind: "codex",
      remoteRoot: "/workspace/with space",
    },
    getAdapter("codex"),
  );
  assert.match(wrapper, /tmux -u new-session -A/);
  assert.match(wrapper, /codex/);
  assert.match(wrapper, /'\/workspace\/with space'/);
  assert.equal(shellQuote("a'b"), "'a'\"'\"'b'");
  const nested = {
    id: "1234567890abcdef",
    agentKind: "codex",
    remoteRoot: "/workspace",
    relativeCwd: "packages/app",
  };
  assert.equal(remoteWorkingDirectory(nested), "/workspace/packages/app");
  assert.match(terminalWrapper(nested, getAdapter("codex")), /packages\/app/);
});

test("resolveBlaxelWorkspace freezes configured or current workspace", () => {
  assert.equal(
    resolveBlaxelWorkspace({ workspace: "configured" }),
    "configured",
  );
  assert.equal(
    resolveBlaxelWorkspace(
      { workspace: null },
      {
        runCommand: (_command, _args, options) => {
          assert.equal(options.check, false);
          return { status: 0, stdout: "current\n" };
        },
      },
    ),
    "current",
  );
  assert.throws(
    () =>
      resolveBlaxelWorkspace(
        { workspace: null },
        { runCommand: () => ({ status: 0, stdout: "\n" }) },
      ),
    /Choose a Blaxel workspace/,
  );
  assert.throws(
    () =>
      resolveBlaxelWorkspace(
        { workspace: null },
        { runCommand: () => ({ status: 1, stdout: "" }) },
      ),
    /Sign in to Blaxel/,
  );
});

test("provisionSandbox creates the declared sandbox and checked Git baseline", async () => {
  const root = temporaryDirectory();
  try {
    const absolutePath = write(root, "README.md", "hello\n");
    const requests = [];
    const binaryWrites = [];
    const textWrites = [];
    let createSpec;
    const sandbox = {
      process: {
        exec: async (request) => {
          requests.push(request);
          if (!request.waitForCompletion) return { pid: request.name };
          if (request.name.startsWith("herdr-version")) {
            return {
              status: "completed",
              exitCode: 0,
              stdout: "codex-cli 0.147.0\n",
            };
          }
          return {
            status: "completed",
            exitCode: 0,
            stdout: `${"a".repeat(40)}\n`,
          };
        },
        wait: async () => ({ status: "completed", exitCode: 0 }),
        logs: async () => "",
      },
      fs: {
        writeBinary: async (remotePath, content) => {
          binaryWrites.push([remotePath, content.toString("utf8")]);
        },
        write: async (remotePath, content) => {
          textWrites.push([remotePath, content]);
        },
      },
    };
    const lifecycle = [];
    const result = await provisionSandbox({
      mapping: testMapping(),
      manifest: {
        files: [
          {
            path: "README.md",
            absolutePath,
            sha256:
              "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
            executable: false,
          },
        ],
      },
      config: { ...DEFAULT_CONFIG, previewPorts: [3000] },
      adapter: getAdapter("codex"),
      onLifecycle: (state, fields) => lifecycle.push([state, fields]),
      createSandbox: async (spec) => {
        createSpec = spec;
        return sandbox;
      },
    });
    assert.equal(createSpec.metadata.name, testMapping().sandboxName);
    assert.equal(createSpec.spec.runtime.image, DEFAULT_CONFIG.image);
    assert.deepEqual(createSpec.spec.runtime.ports, [
      { target: 3000, protocol: "HTTP" },
    ]);
    assert.equal(
      createSpec.spec.runtime.envs.find((entry) => entry.name === "SHELL")
        .value,
      "/bin/sh",
    );
    assert.deepEqual(binaryWrites, [["/workspace/README.md", "hello\n"]]);
    assert.match(
      textWrites.find(([remotePath]) =>
        remotePath.endsWith("herdr-blaxel-shell"),
      )[1],
      /tmux -u new-session -A/,
    );
    assert.ok(
      requests.some((request) => request.name.startsWith("herdr-setup")),
    );
    assert.match(
      requests.find((request) => request.name.startsWith("herdr-setup"))
        .command,
      /trust_level = "trusted"/,
    );
    assert.equal(result.baselineCommit, "a".repeat(40));
    assert.equal(result.installedVersion, "0.147.0");
    assert.deepEqual(
      lifecycle.map(([state]) => state),
      ["creating", "uploading", "preparing"],
    );
    assert.equal(result.capabilities.hostCredentialCopy, false);
  } finally {
    remove(root);
  }
});

test("provisionSandbox fails closed when the installed agent version drifts", async () => {
  const root = temporaryDirectory();
  try {
    const absolutePath = write(root, "README.md", "hello\n");
    const sandbox = {
      process: {
        exec: async (request) => {
          if (!request.waitForCompletion) return { pid: request.name };
          return {
            status: "completed",
            exitCode: 0,
            stdout: "codex-cli 9.9.9\n",
          };
        },
        wait: async () => ({ status: "completed", exitCode: 0 }),
        logs: async () => "",
      },
      fs: { writeBinary: async () => {}, write: async () => {} },
    };
    await assert.rejects(
      provisionSandbox({
        mapping: testMapping(),
        manifest: {
          files: [
            {
              path: "README.md",
              absolutePath,
              sha256:
                "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
              executable: false,
            },
          ],
        },
        config: DEFAULT_CONFIG,
        adapter: getAdapter("codex"),
        createSandbox: async () => sandbox,
      }),
      (error) => error.code === "agent_version_mismatch",
    );
  } finally {
    remove(root);
  }
});

test("provisionSandbox refuses a file changed after the Start snapshot", async () => {
  const root = temporaryDirectory();
  try {
    const absolutePath = write(root, "README.md", "changed\n");
    const sandbox = {
      process: {
        exec: async (request) => ({ pid: request.name }),
        wait: async () => ({ status: "completed", exitCode: 0 }),
      },
      fs: { writeBinary: async () => {}, write: async () => {} },
    };
    await assert.rejects(
      provisionSandbox({
        mapping: testMapping(),
        manifest: {
          files: [
            {
              path: "README.md",
              absolutePath,
              sha256: "0".repeat(64),
              executable: false,
            },
          ],
        },
        config: DEFAULT_CONFIG,
        adapter: getAdapter("codex"),
        createSandbox: async () => sandbox,
      }),
      (error) => error.code === "upload_manifest_changed",
    );
  } finally {
    remove(root);
  }
});

test("provisionSandbox reports a file removed after the Start snapshot cleanly", async () => {
  const root = temporaryDirectory();
  try {
    const absolutePath = write(root, "README.md", "hello\n");
    const sandbox = {
      process: {
        exec: async (request) => ({ pid: request.name }),
        wait: async () => ({ status: "completed", exitCode: 0 }),
      },
      fs: { writeBinary: async () => {}, write: async () => {} },
    };
    fs.unlinkSync(absolutePath);
    await assert.rejects(
      provisionSandbox({
        mapping: testMapping(),
        manifest: {
          files: [
            {
              path: "README.md",
              absolutePath,
              sha256:
                "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
              executable: false,
            },
          ],
        },
        config: DEFAULT_CONFIG,
        adapter: getAdapter("codex"),
        createSandbox: async () => sandbox,
      }),
      (error) =>
        error.code === "upload_manifest_changed" &&
        /removed after the Start snapshot/.test(error.message),
    );
  } finally {
    remove(root);
  }
});

test("terminalWrapper safely appends configured agent arguments", () => {
  const wrapper = terminalWrapper(testMapping(), getAdapter("codex"), [
    "--model",
    "gpt-5.6-terra",
    "prompt with spaces",
  ]);
  assert.match(wrapper, /tmux -u new-session/);
  assert.ok(
    wrapper.includes(
      shellQuote("'codex' '--model' 'gpt-5.6-terra' 'prompt with spaces'"),
    ),
  );
  assert.match(wrapper, /TERM=xterm-256color/);
});

test("sandbox controls preserve files on stop and expose current state", async () => {
  const requests = [];
  let deleted = false;
  let deleteObserved = false;
  const sandbox = {
    status: "DEPLOYED",
    spec: { region: "us-pdx-1", runtime: { image: "blaxel/node:latest" } },
    process: {
      exec: async (request) => {
        requests.push(request);
        return {
          status: "completed",
          exitCode: 0,
          stdout: "agent output\n",
        };
      },
    },
    previews: {
      list: async () => [
        {
          name: "herdr-3000",
          spec: {
            url: "https://preview.example",
            public: false,
            port: 3000,
          },
        },
      ],
    },
    delete: async () => {
      deleted = true;
    },
  };
  const getSandbox = async () => {
    if (deleted) {
      deleteObserved = true;
      return { ...sandbox, status: "TERMINATED", spec: { enabled: false } };
    }
    return sandbox;
  };
  assert.equal(
    (await stopAgent(testMapping(), { getSandbox })).status,
    "stopped",
  );
  assert.match(requests[0].command, /tmux kill-session/);
  assert.equal(
    await captureAgentOutput(testMapping(), 25, { getSandbox }),
    "agent output\n",
  );
  assert.match(requests[1].command, /-S -25/);
  const info = await sandboxInfo(testMapping(), { getSandbox });
  assert.equal(info.exists, true);
  assert.equal(info.status, "DEPLOYED");
  assert.equal(info.previews[0].public, false);
  assert.deepEqual(
    await deleteSandbox(testMapping(), {
      getSandbox,
      deletePollAttempts: 1,
      deletePollIntervalMs: 0,
    }),
    { deleted: true, missing: false, status: "TERMINATED" },
  );
  assert.equal(deleted, true);
  assert.equal(deleteObserved, true);
  const deletedInfo = await sandboxInfo(testMapping(), { getSandbox });
  assert.equal(deletedInfo.exists, false);
  assert.equal(deletedInfo.status, "TERMINATED");
});

test("deleteSandbox fails closed when Blaxel does not confirm deletion", async () => {
  const sandbox = {
    status: "DEPLOYED",
    spec: { enabled: true },
    delete: async () => {},
  };
  await assert.rejects(
    deleteSandbox(testMapping(), {
      getSandbox: async () => sandbox,
      deletePollAttempts: 2,
      deletePollIntervalMs: 0,
    }),
    (error) => error.code === "sandbox_deletion_unconfirmed",
  );
});

test("discoverPreviews reconciles access and limits tokens to the caller", async () => {
  const events = [];
  const desiredPreview = {
    name: "herdr-3000",
    spec: { port: 3000, public: false, url: "https://private.example" },
    tokens: {
      create: async () => ({ value: "temporary", expiresAt: "soon" }),
    },
  };
  const sandbox = {
    fetch: async (port) => {
      if (port === 4000) throw new Error("connection refused");
      return { status: 200, body: { cancel: async () => {} } };
    },
    previews: {
      createIfNotExists: async () => ({
        ...desiredPreview,
        spec: { ...desiredPreview.spec, public: true },
      }),
      delete: async (name) => events.push(["delete", name]),
      create: async (spec) => {
        events.push(["create", spec]);
        return desiredPreview;
      },
    },
  };
  const previews = await discoverPreviews(
    testMapping(),
    { ...DEFAULT_CONFIG, previewPorts: [3000, 4000] },
    {
      getSandbox: async () => sandbox,
      includeTokens: true,
      includeClosed: true,
    },
  );
  assert.deepEqual(
    events.map(([event]) => event),
    ["delete", "create"],
  );
  assert.equal(previews[0].temporaryUrl.includes("temporary"), true);
  assert.equal(previews[0].public, false);
  assert.equal(previews[1].available, false);
});
