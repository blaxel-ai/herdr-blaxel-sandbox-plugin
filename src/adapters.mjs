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
    secretEnvironment: ["OPENAI_API_KEY"],
  }),
  "claude-code": Object.freeze({
    kind: "claude-code",
    title: "Claude Code",
    package: "@anthropic-ai/claude-code@2.1.226",
    launch: ["claude"],
    versionCommand: "claude --version",
    expectedVersion: "2.1.226",
    herdrDetectionKind: "claude",
    secretEnvironment: ["ANTHROPIC_API_KEY"],
  }),
  opencode: Object.freeze({
    kind: "opencode",
    title: "OpenCode",
    package: "opencode-ai@1.14.48",
    launch: ["opencode"],
    versionCommand: "opencode --version",
    expectedVersion: "1.14.48",
    herdrDetectionKind: "opencode",
    secretEnvironment: ["OPENAI_API_KEY"],
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

export function adapterSecretEnvironment(adapter, env = process.env) {
  return adapter.secretEnvironment.flatMap((name) => {
    const value = env[name];
    return typeof value === "string" && value.length > 0
      ? [{ name, value, secret: true }]
      : [];
  });
}

export function agentAuthenticationCommand(adapter, secretNames) {
  if (adapter.kind !== "codex" || !secretNames.includes("OPENAI_API_KEY")) {
    return null;
  }
  return "printf '%s' \"$OPENAI_API_KEY\" | codex login --with-api-key >/dev/null";
}

export function adapterCapabilities(adapter, secretNames = []) {
  return {
    interactiveTTY: true,
    persistentSession: true,
    resumeSupported: true,
    authentication:
      secretNames.length > 0 ? "encrypted-provider-secret" : "inside-sandbox",
    hostCredentialCopy: false,
    secretEnvironment: secretNames,
    herdrDetectionKind: adapter.herdrDetectionKind,
  };
}
