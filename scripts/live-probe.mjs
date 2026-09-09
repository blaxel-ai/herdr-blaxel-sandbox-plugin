// Called by herdr-smoke.py against its isolated test state. Never print URLs or keys.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";
import { readState, updateState } from "../src/state.mjs";
import {
  deleteSandbox,
  discoverPreviews,
  getSandboxOrNull,
  sandboxIsTerminated,
  shellQuote,
  tmuxSessionFor,
} from "../src/sandbox.mjs";

const operation = process.argv[2];
const mappings = Object.values(readState().mappings);
for (const mapping of mappings) {
  assert.ok(mapping.sandboxName.startsWith("herdr-smoke-"));
  assert.equal(path.basename(mapping.localRoot), "invoice-summary");
}

if (operation === "cleanup") {
  for (const mapping of mappings) {
    await deleteSandbox(mapping);
    const remaining = await getSandboxOrNull(
      mapping.sandboxName,
      mapping.blaxelWorkspace,
    );
    assert.ok(!remaining || sandboxIsTerminated(remaining));
    await updateState((state) => {
      delete state.mappings[mapping.id];
      return state;
    });
  }
  console.log("PASS cleanup: test sandboxes absent and mappings removed");
} else {
  assert.equal(mappings.length, 1);
  const mapping = mappings[0];
  const sandbox = await getSandboxOrNull(
    mapping.sandboxName,
    mapping.blaxelWorkspace,
  );
  assert.ok(sandbox && !sandboxIsTerminated(sandbox));
  const exec = async (command) => {
    const result = await sandbox.process.exec({
      name: `herdr-smoke-${Date.now()}`,
      command,
      workingDir: mapping.remoteRoot,
      waitForCompletion: true,
      timeout: 60,
    });
    assert.equal(
      result.exitCode ?? result.exit_code,
      0,
      "remote command failed",
    );
    return String(result.stdout ?? "").trim();
  };
  if (operation === "model") {
    const marker = `herdr-${mapping.agentKind}-verified`;
    const deadline = Date.now() + 120_000;
    let source = "";
    while (Date.now() < deadline) {
      source = await sandbox.fs.read(`${mapping.remoteRoot}/invoices.mjs`);
      if (source.includes(marker)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(source.includes(marker), "model did not edit the fixture");
    await exec(
      `node --input-type=module -e ${shellQuote(`import { integrationProof } from './invoices.mjs'; if (integrationProof() !== ${JSON.stringify(marker)}) process.exit(1);`)}`,
    );
    await exec("npm test");
    console.log(
      `PASS ${mapping.agentKind} model task: real file edit, exported function and repository tests`,
    );
  } else if (operation === "edit") {
    const file = `${mapping.remoteRoot}/invoices.mjs`;
    const source = await sandbox.fs.read(file);
    assert.ok(source.includes("export function summarize(rows)"));
    const updated = source
      .replace("summarize(rows)", "summarize(rows, asOf = '2026-09-08')")
      .replace("count: rows.length,", "count: rows.length, overdueCents: 0,")
      .replace(
        "result.totalCents += row.cents;",
        "if (row.status === 'open' && row.due < asOf) result.overdueCents += row.cents;\n    result.totalCents += row.cents;",
      );
    await sandbox.fs.write(file, updated);
    const testsPath = `${mapping.remoteRoot}/invoices.test.mjs`;
    const tests = (await sandbox.fs.read(testsPath))
      .replace("count: 3,", "count: 3, overdueCents: 84550,")
      .replace("count: 0,", "count: 0, overdueCents: 0,");
    await sandbox.fs.write(
      testsPath,
      `${tests}\ntest('overdue cutoff excludes paid and same-day invoices', () => {\n  assert.equal(summarize(invoices, '2026-08-31').overdueCents, 0);\n  assert.equal(summarize(invoices.filter(row => row.status === 'paid'), '2026-09-08').overdueCents, 0);\n});\n`,
    );
    await exec("npm test");
    await sandbox.fs.write(
      `${mapping.remoteRoot}/server.mjs`,
      `import http from 'node:http';
import { invoices, summarize } from './invoices.mjs';
http.createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/') { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(summarize(invoices, '2026-09-08')));
}).listen(3000, '0.0.0.0');
`,
    );
    await exec(
      "node --input-type=module -e \"import {invoices,summarize} from './invoices.mjs'; if(summarize(invoices,'2026-09-08').overdueCents!==84550) process.exit(1)\"",
    );
    await sandbox.process.exec({
      name: "herdr-smoke-server",
      command: "node server.mjs",
      workingDir: mapping.remoteRoot,
      waitForPorts: [3000],
      timeout: 0,
    });
    console.log("PASS remote edit and tutorial server");
  } else if (operation === "preview") {
    const [preview] = await discoverPreviews(mapping, loadConfig(), {
      includeTokens: true,
      probeTimeoutMs: 10_000,
    });
    assert.ok(preview && !preview.public && preview.temporaryUrl);
    const anonymous = await fetch(preview.url, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(
      [401, 403].includes(anonymous.status),
      "anonymous preview must be denied",
    );
    await anonymous.body?.cancel();
    const response = await fetch(preview.temporaryUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.match(
      response.headers.get("cache-control"),
      /(?:^|,\s*)no-store(?:,|$)/,
    );
    const body = await response.json();
    assert.equal(body.overdueCents, 84550);
    assert.equal(body.totalCents, 439550);
    const missing = new URL(preview.temporaryUrl);
    missing.pathname = "/missing";
    const notFound = await fetch(missing, {
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(notFound.status, 404);
    await notFound.body?.cancel();
    console.log(
      "PASS private preview: anonymous denied, token 200, totals and headers correct, unknown route 404",
    );
  } else if (operation === "session" || operation === "reconnected") {
    // Herdr can show the launch banner before bl connect has created tmux.
    const session = shellQuote(tmuxSessionFor(mapping));
    const identity = await exec(
      `attempts=0; until tmux has-session -t ${session} 2>/dev/null; do attempts=$((attempts + 1)); [ "$attempts" -lt 60 ] || exit 1; sleep 0.5; done; tmux display-message -p -t ${session} '#{session_id}:#{session_created}:#{pane_pid}'`,
    );
    const proof = path.join(
      process.env.HERDR_PLUGIN_STATE_DIR,
      "session-proof.txt",
    );
    if (operation === "session")
      fs.writeFileSync(proof, identity, { mode: 0o600 });
    else assert.equal(identity, fs.readFileSync(proof, "utf8"));
    console.log(`PASS ${operation}: persistent tmux identity`);
  } else if (operation === "stopped") {
    assert.equal(
      await exec(
        `tmux has-session -t ${shellQuote(tmuxSessionFor(mapping))} 2>/dev/null && echo running || echo stopped`,
      ),
      "stopped",
    );
    assert.ok(
      (await sandbox.fs.read(`${mapping.remoteRoot}/server.mjs`)).includes(
        "createServer",
      ),
    );
    console.log("PASS Stop: tmux stopped and remote files preserved");
  } else {
    throw new Error("Unknown smoke operation");
  }
}
