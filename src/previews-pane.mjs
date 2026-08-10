#!/usr/bin/env node
import readline from "node:readline/promises";

import { loadConfig } from "./config.mjs";
import { PluginError, emitFailure } from "./result.mjs";
import { discoverPreviews } from "./sandbox.mjs";
import { readState } from "./state.mjs";

try {
  const mappingId = process.env.BLAXEL_HERDR_MAPPING_ID;
  const mapping = mappingId ? readState().mappings[mappingId] : null;
  if (!mapping)
    throw new PluginError(
      "mapping_not_found",
      "The requested mapping no longer exists.",
    );
  const previews = await discoverPreviews(mapping, loadConfig(), {
    includeTokens: true,
    includeClosed: true,
  });
  process.stdout.write("\u001b[2J\u001b[H");
  process.stdout.write(`Blaxel previews for ${mapping.sandboxName}\n\n`);
  const available = previews.filter((preview) => preview.url);
  if (available.length === 0) {
    process.stdout.write(
      "No configured preview port is currently serving traffic.\n\n",
    );
  }
  for (const preview of previews) {
    if (preview.url) {
      process.stdout.write(
        `Port ${preview.port}: ${preview.public ? preview.url : preview.temporaryUrl}\n`,
      );
      process.stdout.write(
        `  ${preview.public ? "public" : "private token, expires in ten minutes"}\n`,
      );
    } else {
      process.stdout.write(`Port ${preview.port}: not available\n`);
    }
  }
  if (process.stdin.isTTY) {
    const prompt = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await prompt.question("\nPress Enter to close. ");
    prompt.close();
  }
} catch (error) {
  emitFailure("previews-pane", error);
  process.exitCode = 1;
}
