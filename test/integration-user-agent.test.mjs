import assert from "node:assert/strict";
import test from "node:test";

import {
  INTEGRATION_PRODUCT_TOKEN,
  installIntegrationUserAgent,
} from "../src/integration-user-agent.mjs";

class FakeSettings {
  get headers() {
    return {
      "x-blaxel-authorization": "Bearer test-only",
      "x-blaxel-workspace": "example",
      "User-Agent":
        "blaxel/sdk/typescript/0.3.11 (darwin/arm64) blaxel/abc1234",
    };
  }
}

test("token names this plugin and its version", () => {
  assert.match(
    INTEGRATION_PRODUCT_TOKEN,
    /^herdr-blaxel-sandbox-plugin\/\d+\.\d+\.\d+/,
  );
});

test("appends the token to the SDK User-Agent once", () => {
  const target = new FakeSettings();
  installIntegrationUserAgent(target);
  installIntegrationUserAgent(target);
  assert.equal(
    target.headers["User-Agent"],
    `blaxel/sdk/typescript/0.3.11 (darwin/arm64) blaxel/abc1234 ${INTEGRATION_PRODUCT_TOKEN}`,
  );
});

test("leaves every other header untouched", () => {
  const target = new FakeSettings();
  installIntegrationUserAgent(target);
  const rest = { ...target.headers };
  delete rest["User-Agent"];
  assert.deepEqual(rest, {
    "x-blaxel-authorization": "Bearer test-only",
    "x-blaxel-workspace": "example",
  });
});

test("applies to the real SDK settings singleton", async () => {
  process.env.BL_API_KEY ??= "test-only";
  process.env.BL_WORKSPACE ??= "example-workspace";
  const { settings } = await import("@blaxel/core");
  assert.match(
    settings.headers["User-Agent"],
    new RegExp(
      `^blaxel/sdk/typescript/\\S+ \\([^)]+\\) blaxel/\\S+ ${INTEGRATION_PRODUCT_TOKEN.replace("/", "\\/")}$`,
    ),
  );
});
