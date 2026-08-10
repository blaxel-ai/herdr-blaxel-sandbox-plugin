import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { SandboxInstance } from "@blaxel/core";

import { agentInstallCommand, adapterCapabilities } from "./adapters.mjs";
import {
  DEFAULT_INTERACTIVE_ENV_PATH,
  DEFAULT_SHELL_PATH,
} from "./constants.mjs";
import { runSync } from "./process.mjs";
import { PluginError } from "./result.mjs";

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function sandboxNameFor({ prefix, agentKind, localRoot, sourcePaneId }) {
  const base = slug(path.basename(localRoot)).slice(0, 20) || "worktree";
  const agent = slug(agentKind).slice(0, 14);
  const digest = crypto
    .createHash("sha256")
    .update(
      `${localRoot}\u0000${sourcePaneId ?? "workspace"}\u0000${agentKind}`,
    )
    .digest("hex")
    .slice(0, 10);
  return `${slug(prefix).slice(0, 12)}-${agent}-${base}-${digest}`
    .slice(0, 63)
    .replace(/-+$/, "");
}

export function tmuxSessionFor(mapping) {
  return `herdr-${mapping.agentKind}-${mapping.id.slice(0, 10)}`.replace(
    /[^A-Za-z0-9_-]/g,
    "-",
  );
}

function isNotFound(error) {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error.code === 404 || error.code === "404" || error.status === 404),
  );
}

export function sandboxIsTerminated(sandbox) {
  return Boolean(
    sandbox &&
    (String(sandbox.status).toUpperCase() === "TERMINATED" ||
      sandbox.spec?.enabled === false),
  );
}

function selectWorkspace(workspace) {
  if (workspace) process.env.BL_WORKSPACE = workspace;
}

export function resolveBlaxelWorkspace(config, options = {}) {
  if (config.workspace) return config.workspace;
  const runCommand = options.runCommand ?? runSync;
  const result = runCommand("bl", ["workspaces", "--current"], {
    check: false,
  });
  if ((result.status ?? 0) !== 0) {
    throw new PluginError(
      "blaxel_login_required",
      "Sign in to Blaxel, then run Start again.",
    );
  }
  const workspace = result.stdout.trim();
  if (!workspace || workspace.includes("\n")) {
    throw new PluginError(
      "blaxel_workspace_unavailable",
      "Choose a Blaxel workspace, then run Start again.",
    );
  }
  return workspace;
}

export async function getSandboxOrNull(name, workspace) {
  selectWorkspace(workspace);
  try {
    return await SandboxInstance.get(name);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function execChecked(sandbox, request, options = {}) {
  const started = await sandbox.process.exec({
    ...request,
    waitForCompletion: false,
  });
  const identifier = started.pid ?? started.name ?? request.name;
  if (!identifier) {
    throw new PluginError(
      "remote_process_missing_id",
      `${request.name ?? "Remote process"} returned no identifier.`,
    );
  }
  const finished = await sandbox.process.wait(identifier, {
    maxWait: options.maxWait ?? 5 * 60 * 1000,
    interval: options.interval ?? 500,
  });
  const status = String(finished.status ?? "").toLowerCase();
  const exitCode = finished.exitCode ?? finished.exit_code;
  if (status === "failed" || (Number.isInteger(exitCode) && exitCode !== 0)) {
    const logs = await sandbox.process.logs(identifier).catch(() => "");
    throw new PluginError(
      "remote_process_failed",
      `${request.name ?? "Remote process"} failed${logs.trim() ? `: ${logs.trim()}` : ""}.`,
      {
        details: { status, exitCode },
      },
    );
  }
  return finished;
}

function setupCommand(adapter) {
  return [
    "set -eu",
    "if ! command -v git >/dev/null 2>&1 || ! command -v tmux >/dev/null 2>&1; then",
    "  if command -v apk >/dev/null 2>&1; then apk add --no-cache git tmux;",
    "  elif command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git tmux;",
    "  elif command -v dnf >/dev/null 2>&1; then dnf install -y git tmux;",
    "  else echo 'A supported package manager is required to install git and tmux.' >&2; exit 1; fi",
    "fi",
    agentInstallCommand(adapter),
  ].join("\n");
}

export function remoteWorkingDirectory(mapping) {
  return mapping.relativeCwd && mapping.relativeCwd !== "."
    ? path.posix.join(mapping.remoteRoot, mapping.relativeCwd)
    : mapping.remoteRoot;
}

export function terminalWrapper(mapping, adapter) {
  const tmuxSession = tmuxSessionFor(mapping);
  const command = adapter.launch.map(shellQuote).join(" ");
  const workingDirectory = remoteWorkingDirectory(mapping);
  return `#!/bin/sh\nset -eu\nexport HERDR_AGENT=${shellQuote(adapter.herdrDetectionKind)}\ncd ${shellQuote(workingDirectory)}\nexec tmux new-session -A -s ${shellQuote(tmuxSession)} -c ${shellQuote(workingDirectory)} ${shellQuote(command)}\n`;
}

export function interactiveShellBootstrap() {
  return `exec ${shellQuote(DEFAULT_SHELL_PATH)}\n`;
}

async function ensureRemoteDirectories(sandbox, mapping, manifest) {
  const directories = new Set([
    mapping.remoteRoot,
    remoteWorkingDirectory(mapping),
    path.posix.dirname(DEFAULT_SHELL_PATH),
    path.posix.dirname(DEFAULT_INTERACTIVE_ENV_PATH),
  ]);
  for (const file of manifest.files) {
    directories.add(
      path.posix.dirname(path.posix.join(mapping.remoteRoot, file.path)),
    );
  }
  const sorted = [...directories].sort();
  for (let index = 0; index < sorted.length; index += 200) {
    const batch = sorted.slice(index, index + 200);
    await execChecked(
      sandbox,
      {
        name: `herdr-mkdir-${mapping.id.slice(0, 8)}-${index / 200}`,
        command: `mkdir -p ${batch.map(shellQuote).join(" ")}`,
        workingDir: "/",
      },
      { maxWait: 60_000 },
    );
  }
}

async function uploadFiles(sandbox, mapping, manifest) {
  await ensureRemoteDirectories(sandbox, mapping, manifest);
  const concurrency = 6;
  let index = 0;
  async function worker() {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= manifest.files.length) return;
      const file = manifest.files[current];
      const remotePath = path.posix.join(mapping.remoteRoot, file.path);
      const content = fs.readFileSync(file.absolutePath);
      const digest = crypto.createHash("sha256").update(content).digest("hex");
      if (digest !== file.sha256) {
        throw new PluginError(
          "upload_manifest_changed",
          `${file.path} changed after approval.`,
        );
      }
      await sandbox.fs.writeBinary(remotePath, content);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, manifest.files.length || 1) },
      () => worker(),
    ),
  );
  const executable = manifest.files.filter((file) => file.executable);
  for (let index = 0; index < executable.length; index += 200) {
    const batch = executable.slice(index, index + 200);
    await execChecked(
      sandbox,
      {
        name: `herdr-chmod-${mapping.id.slice(0, 8)}-${index / 200}`,
        command: `chmod +x ${batch
          .map((file) =>
            shellQuote(path.posix.join(mapping.remoteRoot, file.path)),
          )
          .join(" ")}`,
        workingDir: "/",
      },
      { maxWait: 60_000 },
    );
  }
}

async function verifyAgentVersion(sandbox, mapping, adapter) {
  const result = await sandbox.process.exec({
    name: `herdr-version-${mapping.id.slice(0, 8)}`,
    command: adapter.versionCommand,
    workingDir: mapping.remoteRoot,
    waitForCompletion: true,
    timeout: 60,
  });
  const exitCode = result.exitCode ?? result.exit_code;
  const output = String(
    result.stdout ?? result.logs ?? result.stderr ?? "",
  ).trim();
  if (
    String(result.status).toLowerCase() === "failed" ||
    (Number.isInteger(exitCode) && exitCode !== 0) ||
    !output.includes(adapter.expectedVersion)
  ) {
    throw new PluginError(
      "agent_version_mismatch",
      `${adapter.title} did not report expected version ${adapter.expectedVersion}.`,
      { details: { exitCode, output } },
    );
  }
  return adapter.expectedVersion;
}

async function initializeRemoteGit(sandbox, mapping) {
  const command = [
    "set -eu",
    `cd ${shellQuote(mapping.remoteRoot)}`,
    "git init -q",
    "git config user.name 'Herdr Blaxel Plugin'",
    "git config user.email 'herdr-blaxel@localhost'",
    "git add -f -A",
    "git commit -q --allow-empty -m 'Herdr local upload baseline'",
    "git rev-parse HEAD",
  ].join("\n");
  const result = await sandbox.process.exec({
    name: `herdr-baseline-${mapping.id.slice(0, 8)}`,
    command,
    workingDir: mapping.remoteRoot,
    waitForCompletion: true,
    timeout: 60,
  });
  const exitCode = result.exitCode ?? result.exit_code;
  if (
    String(result.status).toLowerCase() === "failed" ||
    (Number.isInteger(exitCode) && exitCode !== 0)
  ) {
    throw new PluginError(
      "remote_git_init_failed",
      result.stderr ||
        result.logs ||
        "Could not create the remote Git baseline.",
    );
  }
  const commit = String(result.stdout ?? "")
    .trim()
    .split(/\s+/)
    .at(-1);
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
    throw new PluginError(
      "remote_git_init_failed",
      "The remote Git baseline returned no commit.",
    );
  }
  return commit;
}

export async function provisionSandbox({
  mapping,
  manifest,
  config,
  adapter,
  onLifecycle,
  createSandbox = (spec) => SandboxInstance.createIfNotExists(spec),
}) {
  selectWorkspace(mapping.blaxelWorkspace ?? config.workspace);
  await onLifecycle?.("creating");
  const sandbox = await createSandbox({
    name: mapping.sandboxName,
    image: config.image,
    memory: config.memory,
    region: config.region ?? undefined,
    ttl: config.idleDelete,
    ports: config.previewPorts.map((target) => ({ target, protocol: "HTTP" })),
    envs: [
      { name: "SHELL", value: "/bin/sh" },
      { name: "ENV", value: DEFAULT_INTERACTIVE_ENV_PATH },
      { name: "HERDR_BLAXEL_AGENT_KIND", value: mapping.agentKind },
      { name: "HERDR_BLAXEL_REMOTE_ROOT", value: mapping.remoteRoot },
    ],
    labels: {
      integration: "herdr",
      agent: mapping.agentKind,
      mapping: mapping.id,
    },
  });
  await onLifecycle?.("uploading");
  await uploadFiles(sandbox, mapping, manifest);
  await onLifecycle?.("preparing");
  await sandbox.fs.write(DEFAULT_SHELL_PATH, terminalWrapper(mapping, adapter));
  await sandbox.fs.write(
    DEFAULT_INTERACTIVE_ENV_PATH,
    interactiveShellBootstrap(),
  );
  await execChecked(
    sandbox,
    {
      name: `herdr-setup-${mapping.id.slice(0, 8)}`,
      command: setupCommand(adapter),
      workingDir: "/",
    },
    { maxWait: 10 * 60 * 1000 },
  );
  const installedVersion = await verifyAgentVersion(sandbox, mapping, adapter);
  await execChecked(
    sandbox,
    {
      name: `herdr-wrapper-${mapping.id.slice(0, 8)}`,
      command: `chmod 0755 ${shellQuote(DEFAULT_SHELL_PATH)}`,
      workingDir: "/",
    },
    { maxWait: 60_000 },
  );
  const baselineCommit = await initializeRemoteGit(sandbox, mapping);
  return {
    sandbox,
    baselineCommit,
    installedVersion,
    capabilities: adapterCapabilities(adapter),
  };
}

export async function stopAgent(mapping, options = {}) {
  const getSandbox = options.getSandbox ?? getSandboxOrNull;
  const sandbox = await getSandbox(
    mapping.sandboxName,
    mapping.blaxelWorkspace,
  );
  if (!sandbox || sandboxIsTerminated(sandbox)) return { status: "missing" };
  const session = tmuxSessionFor(mapping);
  const result = await sandbox.process.exec({
    name: `herdr-stop-${mapping.id.slice(0, 8)}-${Date.now()}`,
    command: `tmux has-session -t ${shellQuote(session)} 2>/dev/null && tmux kill-session -t ${shellQuote(session)} || true`,
    workingDir: mapping.remoteRoot,
    waitForCompletion: true,
    timeout: 60,
  });
  return { status: "stopped", result };
}

export async function captureAgentOutput(mapping, lines = 200, options = {}) {
  const getSandbox = options.getSandbox ?? getSandboxOrNull;
  const sandbox = await getSandbox(
    mapping.sandboxName,
    mapping.blaxelWorkspace,
  );
  if (!sandbox || sandboxIsTerminated(sandbox))
    throw new PluginError(
      "sandbox_not_found",
      `Sandbox ${mapping.sandboxName} no longer exists.`,
    );
  const session = tmuxSessionFor(mapping);
  const result = await sandbox.process.exec({
    name: `herdr-logs-${mapping.id.slice(0, 8)}-${Date.now()}`,
    command: `tmux capture-pane -pt ${shellQuote(session)} -S -${Math.max(1, Math.min(lines, 2_000))}`,
    workingDir: mapping.remoteRoot,
    waitForCompletion: true,
    timeout: 60,
  });
  const exitCode = result.exitCode ?? result.exit_code;
  if (
    String(result.status).toLowerCase() === "failed" ||
    (Number.isInteger(exitCode) && exitCode !== 0)
  ) {
    throw new PluginError(
      "agent_session_not_running",
      "The remote agent session is not running.",
    );
  }
  return String(result.stdout ?? result.logs ?? "");
}

export async function deleteSandbox(mapping, options = {}) {
  const getSandbox = options.getSandbox ?? getSandboxOrNull;
  let sandbox = await getSandbox(mapping.sandboxName, mapping.blaxelWorkspace);
  if (!sandbox) return { deleted: false, missing: true, status: "MISSING" };
  if (sandboxIsTerminated(sandbox)) {
    return { deleted: false, missing: false, status: "TERMINATED" };
  }
  await sandbox.delete();
  const attempts = options.deletePollAttempts ?? 60;
  const interval = options.deletePollIntervalMs ?? 500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    sandbox = await getSandbox(mapping.sandboxName, mapping.blaxelWorkspace);
    if (!sandbox) return { deleted: true, missing: true, status: "MISSING" };
    if (sandboxIsTerminated(sandbox)) {
      return { deleted: true, missing: false, status: "TERMINATED" };
    }
    if (attempt + 1 < attempts) await delay(interval);
  }
  throw new PluginError(
    "sandbox_deletion_unconfirmed",
    `Blaxel did not confirm deletion of ${mapping.sandboxName}.`,
  );
}

export async function sandboxInfo(mapping, options = {}) {
  const getSandbox = options.getSandbox ?? getSandboxOrNull;
  const sandbox = await getSandbox(
    mapping.sandboxName,
    mapping.blaxelWorkspace,
  );
  if (!sandbox || sandboxIsTerminated(sandbox))
    return {
      exists: false,
      name: mapping.sandboxName,
      status: sandboxIsTerminated(sandbox) ? "TERMINATED" : "MISSING",
      previews: [],
    };
  const previews = await sandbox.previews.list().catch(() => []);
  return {
    exists: true,
    name: mapping.sandboxName,
    status: sandbox.status,
    region: sandbox.spec?.region ?? null,
    image: sandbox.spec?.runtime?.image ?? null,
    previews: previews.map((preview) => ({
      name: preview.name,
      url: preview.spec?.url ?? null,
      public: preview.spec?.public ?? false,
      port: preview.spec?.port ?? null,
    })),
  };
}

export async function discoverPreviews(mapping, config, options = {}) {
  const getSandbox = options.getSandbox ?? getSandboxOrNull;
  const sandbox = await getSandbox(
    mapping.sandboxName,
    mapping.blaxelWorkspace,
  );
  if (!sandbox || sandboxIsTerminated(sandbox))
    throw new PluginError(
      "sandbox_not_found",
      `Sandbox ${mapping.sandboxName} no longer exists.`,
    );
  const discovered = [];
  for (const port of config.previewPorts) {
    let response;
    try {
      response = await sandbox.fetch(port, "/", {
        method: "GET",
        signal: AbortSignal.timeout(options.probeTimeoutMs ?? 2_000),
      });
    } catch (error) {
      if (options.includeClosed)
        discovered.push({ port, available: false, error: error.message });
      continue;
    }
    await response.body?.cancel();
    const desired = {
      metadata: { name: `herdr-${port}` },
      spec: { port, public: config.publicPreviews },
    };
    let preview = await sandbox.previews.createIfNotExists(desired);
    if (
      preview.spec?.port !== port ||
      preview.spec?.public !== config.publicPreviews
    ) {
      await sandbox.previews.delete(desired.metadata.name);
      preview = await sandbox.previews.create(desired);
    }
    const item = {
      port,
      status: response.status,
      name: preview.name,
      url: preview.spec?.url ?? null,
      public: preview.spec?.public ?? false,
    };
    if (!item.public && options.includeTokens) {
      const token = await preview.tokens.create(
        new Date(Date.now() + 10 * 60 * 1000),
      );
      const temporary = new URL(item.url);
      temporary.searchParams.set("bl_preview_token", token.value);
      item.temporaryUrl = temporary.toString();
      item.tokenExpiresAt = token.expiresAt;
    }
    discovered.push(item);
  }
  return discovered;
}
