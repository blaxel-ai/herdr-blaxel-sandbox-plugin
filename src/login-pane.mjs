#!/usr/bin/env node
import { spawn } from "node:child_process";

import { loadConfig } from "./config.mjs";

const config = loadConfig();
const requestedWorkspace =
  process.env.BLAXEL_HERDR_LOGIN_WORKSPACE?.trim() || config.workspace;
const args = requestedWorkspace ? ["login", requestedWorkspace] : ["login"];
const child = spawn("bl", args, { stdio: "inherit", env: process.env });
child.on("error", (error) => {
  console.error(`Could not start the Blaxel CLI: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
