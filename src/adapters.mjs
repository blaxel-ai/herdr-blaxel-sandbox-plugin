import { PluginError } from "./result.mjs";
import { shellQuote } from "./process.mjs";

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
    configure: (workingDirectory) => [
      'mkdir -p "$HOME/.codex"',
      `printf '%s' ${shellQuote(`[projects.${JSON.stringify(workingDirectory)}]\ntrust_level = "trusted"\n`)} > "$HOME/.codex/config.toml"`,
    ],
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
    secretEnvironment: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  }),
  pi: Object.freeze({
    kind: "pi",
    title: "Pi",
    package: "@mariozechner/pi-coding-agent@0.73.1",
    // Keep transitive ranges on the verified snapshot, including AWS SDK packages.
    installBefore: "2026-09-09T18:00:00Z",
    launch: ["pi"],
    versionCommand: "pi --version",
    expectedVersion: "0.73.1",
    herdrDetectionKind: "pi",
    environment: [{ name: "PI_SKIP_VERSION_CHECK", value: "1" }],
    secretEnvironment: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  }),
});

export const AGENT_KINDS = Object.freeze(Object.keys(ADAPTERS));

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
  const before = adapter.installBefore
    ? ` --before=${shellQuote(adapter.installBefore)}`
    : "";
  return `npm install --global --no-audit --no-fund${before} ${adapter.package}`;
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

export function agentSetupCommands(adapter, secretNames, workingDirectory) {
  const authentication = agentAuthenticationCommand(adapter, secretNames);
  return [
    ...(authentication ? [authentication] : []),
    ...(adapter.configure?.(workingDirectory) ?? []),
  ];
}
