#!/usr/bin/env node
import { runAction } from "./actions.mjs";
import { emitFailure } from "./result.mjs";

const action = process.env.HERDR_PLUGIN_ACTION_ID || "unknown";

try {
  await runAction(action);
} catch (error) {
  emitFailure(action, error);
  process.exitCode = 1;
}
