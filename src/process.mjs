import { spawnSync } from "node:child_process";

import { PluginError } from "./result.mjs";

export function runSync(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new PluginError(
      "command_start_failed",
      `${command} could not start: ${result.error.message}`,
      {
        cause: result.error,
      },
    );
  }
  if (options.check !== false && result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    const stdout = String(result.stdout ?? "").trim();
    throw new PluginError(
      "command_failed",
      `${command} exited with ${result.status}${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`,
      { details: { command, args, exitCode: result.status } },
    );
  }
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
