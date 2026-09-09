import assert from "node:assert/strict";
import test from "node:test";

test("attributes control-plane and sandbox uploads without changing authentication", async (t) => {
  process.env.BL_API_KEY = "test-only";
  process.env.BL_WORKSPACE = "example-workspace";
  process.env.BL_API_URL = "https://control.invalid/v0";
  process.env.BL_RUN_URL = "https://sandbox.invalid";
  process.env.BL_ENV = "prod";
  process.env.DO_NOT_TRACK = "1";

  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    assert.ok(
      ["control.invalid", "sandbox.invalid"].includes(
        new URL(request.url).host,
      ),
      "The test must never contact a real service",
    );
    requests.push(request);
    return Response.json({ metadata: { name: "example" } });
  });

  const { INTEGRATION_PRODUCT_TOKEN } =
    await import("../src/integration-user-agent.mjs");
  const { getSandbox, SandboxInstance } = await import("@blaxel/core");
  await getSandbox({ path: { sandboxName: "example" } });
  const sandbox = new SandboxInstance({ metadata: { name: "example" } });
  await sandbox.fs.write("/example.txt", "example");
  await sandbox.fs.writeBinary("/example.bin", Buffer.from("example"));

  assert.equal(requests.length, 3);
  assert.equal(new URL(requests[0].url).host, "control.invalid");
  for (const request of requests.slice(1)) {
    assert.equal(new URL(request.url).host, "sandbox.invalid");
  }
  for (const request of requests) {
    const tokens = request.headers.get("User-Agent").split(" ");
    assert.equal(
      tokens.filter((token) => token === INTEGRATION_PRODUCT_TOKEN).length,
      1,
    );
    assert.match(tokens[0], /^blaxel\/sdk\/typescript\//);
    assert.equal(
      request.headers.get("x-blaxel-authorization"),
      "Bearer test-only",
    );
    assert.equal(
      request.headers.get("x-blaxel-workspace"),
      "example-workspace",
    );
  }
});
