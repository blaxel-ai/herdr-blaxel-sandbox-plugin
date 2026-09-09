#!/usr/bin/env node
import { isMain, runPane } from "./terminal-ui.mjs";

import { loadConfig } from "./config.mjs";
import { PluginError } from "./result.mjs";
import { discoverPreviews } from "./sandbox.mjs";
import { readState } from "./state.mjs";

export async function showPreviews(mapping, ui) {
  const previews = await discoverPreviews(mapping, loadConfig(), {
    includeTokens: true,
    includeClosed: true,
  });

  ui.write(`Blaxel previews for ${mapping.sandboxName}\n\n`);
  const available = previews.filter((preview) => preview.url);
  if (available.length === 0) {
    ui.write("No configured preview port is currently serving traffic.\n\n");
  }
  for (const preview of previews) {
    if (preview.url) {
      ui.write(
        `Port ${preview.port}: ${preview.public ? preview.url : preview.temporaryUrl}\n`,
      );
      ui.write(
        `  ${preview.public ? "public" : "private token, expires in ten minutes"}\n`,
      );
    } else {
      ui.write(`Port ${preview.port}: not available\n`);
    }
  }
  await ui.ask("Enter or Esc to close");
}

if (isMain(import.meta.url))
  await runPane("Application previews", (ui) => {
    const mapping = readState().mappings[process.env.BLAXEL_HERDR_MAPPING_ID];
    if (!mapping)
      throw new PluginError(
        "mapping_not_found",
        "The requested mapping no longer exists.",
      );
    return showPreviews(mapping, ui);
  });
