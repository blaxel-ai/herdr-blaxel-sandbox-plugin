import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = fs.readFileSync(path.join(root, "herdr-plugin.toml"), "utf8");
const required = [
  'id = "blaxel.sandbox"',
  'min_herdr_version = "0.8.0"',
  'id = "start-agent"',
  'id = "reconnect"',
  'id = "apply-changes"',
  'id = "stop"',
  'id = "info"',
  'id = "replace-sandbox"',
  'id = "delete-sandbox"',
];

for (const field of required) {
  if (!manifest.includes(field))
    throw new Error(`herdr-plugin.toml is missing ${field}`);
}

for (const match of manifest.matchAll(/command = \["node", "([^"]+)"\]/g)) {
  const commandPath = path.join(root, match[1]);
  if (!fs.existsSync(commandPath))
    throw new Error(`Manifest command does not exist: ${match[1]}`);
}

console.log("manifest verified");
