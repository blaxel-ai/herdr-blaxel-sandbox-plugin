import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { runSync } from "./process.mjs";
import { PluginError } from "./result.mjs";

const ALWAYS_EXCLUDED_COMPONENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".aws",
  ".ssh",
  ".gnupg",
  ".vercel",
  "node_modules",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  "dist",
  "build",
  "target",
  "coverage",
]);

const SENSITIVE_BASENAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "credentials.json",
  "service-account.json",
  "terraform.tfstate",
  "terraform.tfstate.backup",
  "id_rsa",
  "id_ed25519",
]);

const SENSITIVE_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
]);

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bgh[opsu]_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

function normalizeRelative(relativePath) {
  const normalized = relativePath
    .split(path.sep)
    .join("/")
    .replace(/^\.\//, "");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new PluginError(
      "unsafe_path",
      `Unsafe worktree path: ${relativePath}.`,
    );
  }
  return normalized;
}

function matchesPrefix(relativePath, prefix) {
  const normalized = prefix.replace(/^\.\//, "").replace(/\/$/, "");
  return (
    relativePath === normalized || relativePath.startsWith(`${normalized}/`)
  );
}

export function pathExclusionReason(relativePath, config) {
  const normalized = normalizeRelative(relativePath);
  const components = normalized.split("/");
  if (
    components.some((component) => ALWAYS_EXCLUDED_COMPONENTS.has(component))
  ) {
    return "blocked-directory";
  }
  if (config.allowSensitivePaths.includes(normalized)) return null;
  const base = components.at(-1);
  const lowerBase = base.toLowerCase();
  if (
    lowerBase.startsWith(".env") &&
    !lowerBase.includes("example") &&
    !lowerBase.includes("sample")
  ) {
    return "environment-file";
  }
  if (SENSITIVE_BASENAMES.has(lowerBase)) return "credential-file";
  if (SENSITIVE_EXTENSIONS.has(path.posix.extname(lowerBase)))
    return "credential-extension";
  if (
    normalized.startsWith(".config/gcloud/") ||
    normalized.startsWith(".terraform/")
  ) {
    return "credential-directory";
  }
  if (
    config.excludedPaths.some((prefix) => matchesPrefix(normalized, prefix))
  ) {
    return "configured-exclusion";
  }
  return null;
}

function contentExclusionReason(buffer) {
  if (buffer.includes(0)) return null;
  const text = buffer.toString("utf8");
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
    ? "detected-secret"
    : null;
}

function fileDigest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function manifestDigest(files) {
  const canonical = files.map(
    ({ path: filePath, size, sha256, executable }) => ({
      path: filePath,
      size,
      sha256,
      executable,
    }),
  );
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export function approvalFingerprint({ config, adapter, workspace }) {
  const target = {
    agent: adapter.kind,
    package: adapter.package,
    workspace,
    region: config.region,
    image: config.image,
    memory: config.memory,
    remoteRoot: config.remoteRoot,
    idleDelete: config.idleDelete,
    sandboxNamePrefix: config.sandboxNamePrefix,
    previewPorts: config.previewPorts,
    publicPreviews: config.publicPreviews,
    excludedPaths: config.excludedPaths,
    allowSensitivePaths: config.allowSensitivePaths,
    maxFiles: config.maxFiles,
    maxFileBytes: config.maxFileBytes,
    maxUploadBytes: config.maxUploadBytes,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(target))
    .digest("hex");
}

export function buildUploadManifest(root, config) {
  const listed = runSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    {
      cwd: root,
      maxBuffer: Math.max(32 * 1024 * 1024, config.maxFiles * 1024),
    },
  ).stdout;
  const candidates = listed
    .split("\u0000")
    .filter(Boolean)
    .map(normalizeRelative)
    .sort();
  if (candidates.length > config.maxFiles) {
    throw new PluginError(
      "upload_file_limit",
      `The worktree has ${candidates.length} eligible candidates; the limit is ${config.maxFiles}.`,
    );
  }
  const files = [];
  const excluded = [];
  let totalBytes = 0;
  for (const relativePath of candidates) {
    const pathReason = pathExclusionReason(relativePath, config);
    if (pathReason) {
      excluded.push({ path: relativePath, reason: pathReason });
      continue;
    }
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile()) {
      excluded.push({
        path: relativePath,
        reason: stat.isSymbolicLink() ? "symbolic-link" : "not-regular-file",
      });
      continue;
    }
    if (stat.size > config.maxFileBytes) {
      throw new PluginError(
        "upload_file_too_large",
        `${relativePath} is ${stat.size} bytes; the per-file limit is ${config.maxFileBytes}.`,
      );
    }
    const buffer = fs.readFileSync(absolutePath);
    const contentReason = config.allowSensitivePaths.includes(relativePath)
      ? null
      : contentExclusionReason(buffer);
    if (contentReason) {
      excluded.push({ path: relativePath, reason: contentReason });
      continue;
    }
    totalBytes += buffer.byteLength;
    if (totalBytes > config.maxUploadBytes) {
      throw new PluginError(
        "upload_size_limit",
        `The filtered upload exceeds ${config.maxUploadBytes} bytes.`,
      );
    }
    files.push({
      path: relativePath,
      absolutePath,
      size: buffer.byteLength,
      sha256: fileDigest(buffer),
      executable: Boolean(stat.mode & 0o111),
    });
  }
  return {
    schemaVersion: 1,
    root,
    files,
    excluded,
    totalBytes,
    digest: manifestDigest(files),
  };
}

export function formatManifest(manifest, options = {}) {
  const lines = [];
  if (options.target) {
    const { target } = options;
    lines.push(
      "Blaxel target",
      `  Sandbox: ${target.sandboxName}`,
      `  Workspace: ${target.workspace}`,
      `  Agent: ${target.agent}`,
      `  Image: ${target.image}`,
      `  Region: ${target.region ?? "workspace default"}`,
      `  Memory: ${target.memory} MB`,
      `  Remote root: ${target.remoteRoot}`,
      `  Idle deletion: ${target.idleDelete}`,
      `  Previews: ${target.publicPreviews ? "public" : "private"} on ${target.previewPorts.length > 0 ? target.previewPorts.join(", ") : "no ports"}`,
      "",
    );
  }
  lines.push(
    `Upload preview: ${manifest.files.length} ${manifest.files.length === 1 ? "file" : "files"}, ${manifest.totalBytes} bytes`,
    `Digest: ${manifest.digest}`,
    "",
  );
  for (const file of manifest.files) {
    lines.push(
      `  ${file.path} (${file.size} bytes${file.executable ? ", executable" : ""})`,
    );
  }
  if (manifest.excluded.length > 0) {
    lines.push("", `Excluded: ${manifest.excluded.length}`);
    for (const excluded of manifest.excluded)
      lines.push(`  ${excluded.path} [${excluded.reason}]`);
  }
  lines.push(
    "",
    `Run ${options.actionTitle ?? "Start configured agent in Blaxel"} again within ${options.approvalSeconds ?? 600} seconds to approve this exact target and digest.`,
  );
  return lines.join("\n");
}
