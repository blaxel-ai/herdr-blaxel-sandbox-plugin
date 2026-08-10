import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptsRoot = path.join(root, "verification", "receipts");

if (!fs.existsSync(receiptsRoot)) {
  throw new Error("verification/receipts is missing");
}

const receiptFiles = fs
  .readdirSync(receiptsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(receiptsRoot, entry.name, "receipt.json"))
  .filter((file) => fs.existsSync(file));

if (receiptFiles.length === 0)
  throw new Error("no verification receipts found");

for (const receiptFile of receiptFiles) {
  const receiptDirectory = path.dirname(receiptFile);
  const receiptStat = fs.lstatSync(receiptFile);
  if (!receiptStat.isFile() || receiptStat.isSymbolicLink()) {
    throw new Error(`${receiptFile} must be a regular file`);
  }
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  if (
    receipt.schemaVersion !== 1 ||
    !Array.isArray(receipt.artifacts) ||
    receipt.artifacts.length === 0
  ) {
    throw new Error(`${receiptFile} has an unsupported shape`);
  }
  const artifactPaths = new Set();
  for (const artifact of receipt.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== "string" ||
      !/^[a-z0-9][a-z0-9._-]*$/i.test(artifact.path) ||
      !/^[0-9a-f]{64}$/.test(artifact.sha256)
    ) {
      throw new Error(`${receiptFile} has an invalid artifact entry`);
    }
    if (artifactPaths.has(artifact.path)) {
      throw new Error(`${receiptFile} repeats ${artifact.path}`);
    }
    artifactPaths.add(artifact.path);
    const artifactFile = path.join(receiptDirectory, artifact.path);
    const artifactStat = fs.lstatSync(artifactFile);
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
      throw new Error(`${artifactFile} must be a regular file`);
    }
    const digest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(artifactFile))
      .digest("hex");
    if (digest !== artifact.sha256) {
      throw new Error(`${artifactFile} does not match its receipt hash`);
    }
  }
}

console.log(`verified ${receiptFiles.length} receipt(s)`);
