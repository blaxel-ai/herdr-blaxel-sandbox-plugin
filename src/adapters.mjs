import { PluginError } from "./result.mjs";

const ADAPTERS = Object.freeze({
  codex: Object.freeze({
    kind: "codex",
    title: "Codex",
    package: "@openai/codex@0.147.0",
    launch: ["codex"],
    versionCommand: "codex --version",
    expectedVersion: "0.147.0",
    herdrDetectionKind: "codex",
  }),
  "claude-code": Object.freeze({
    kind: "claude-code",
    title: "Claude Code",
    package: "@anthropic-ai/claude-code@2.1.226",
    launch: ["claude"],
    versionCommand: "claude --version",
    expectedVersion: "2.1.226",
    herdrDetectionKind: "claude",
  }),
  opencode: Object.freeze({
    kind: "opencode",
    title: "OpenCode",
    package: "opencode-ai@1.14.48",
    launch: ["opencode"],
    versionCommand: "opencode --version",
    expectedVersion: "1.14.48",
    herdrDetectionKind: "opencode",
  }),
});

export function listAdapters() {
  return Object.values(ADAPTERS);
}

export function getAdapter(kind) {
  const adapter = ADAPTERS[kind];
  if (!adapter) {
    throw new PluginError("unsupported_agent", `Unsupported agent: ${kind}.`);
  }
  return adapter;
}

export function agentInstallCommand(adapter) {
  return `npm install --global --no-audit --no-fund ${adapter.package}`;
}

export function adapterCapabilities(adapter) {
  return {
    interactiveTTY: true,
    persistentSession: true,
    resumeSupported: true,
    authentication: "inside-sandbox",
    hostCredentialCopy: false,
    herdrDetectionKind: adapter.herdrDetectionKind,
  };
}
