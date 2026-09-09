import path from "node:path";

import { runSync } from "./process.mjs";

export function formatAge(iso, now = Date.now()) {
  const elapsed = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function repositoryInfo(mapping, options = {}) {
  const runCommand = options.runCommand ?? runSync;
  const branchResult = runCommand("git", ["branch", "--show-current"], {
    cwd: mapping.localRoot,
    check: false,
  });
  const branch = branchResult.status === 0 ? branchResult.stdout.trim() : "";
  return {
    name: path.basename(mapping.localRoot),
    branch: branch || "detached",
    path: mapping.localRoot,
    cwd: mapping.localCwd,
  };
}

export function missingMappingsToPrune(
  mappings,
  remoteCache,
  counts,
  limit = 3,
) {
  const prune = [];
  const activeIds = new Set(mappings.map(({ id }) => id));
  for (const id of counts.keys()) {
    if (!activeIds.has(id)) counts.delete(id);
  }
  for (const mapping of mappings) {
    if (
      !["ready", "connected", "stopped", "missing", "failed"].includes(
        mapping.lifecycleState,
      )
    ) {
      counts.delete(mapping.id);
      continue;
    }
    const remote = remoteCache.get(mapping.id);
    if (remote?.exists === false && !remote.error) {
      const next = (counts.get(mapping.id) ?? 0) + 1;
      counts.set(mapping.id, next);
      if (next >= limit) prune.push(mapping.id);
    } else if (remote) {
      counts.delete(mapping.id);
    }
  }
  return prune;
}
