import { createRequire } from "node:module";

import { settings } from "@blaxel/core";

const require = createRequire(import.meta.url);
const { name, version } = require("../package.json");

/** Product token appended to the Blaxel SDK User-Agent so Blaxel can attribute traffic to this plugin. */
export const INTEGRATION_PRODUCT_TOKEN = `${name}/${version}`;

const INSTALLED = Symbol.for("blaxel.integrationUserAgent");

/**
 * Appends the integration product token to this process's Blaxel SDK requests.
 *
 * The SDK builds headers from one getter that both control-plane calls and
 * sandbox data-plane calls read, so shadowing it on the singleton covers every
 * authenticated SDK request without touching credentials or adding any other
 * header. Idempotent. The pinned SDK has no native integration setting.
 * Requests made by the separate bl CLI process retain the CLI's User-Agent.
 */
export function installIntegrationUserAgent(target = settings) {
  if (target[INSTALLED] === true) return;
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(target),
    "headers",
  );
  const base = descriptor?.get;
  if (base === undefined) return;
  Object.defineProperty(target, "headers", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      const headers = base.call(target);
      const agent = headers["User-Agent"];
      if (agent === undefined || agent.endsWith(INTEGRATION_PRODUCT_TOKEN))
        return headers;
      return {
        ...headers,
        "User-Agent": `${agent} ${INTEGRATION_PRODUCT_TOKEN}`,
      };
    },
  });
  Object.defineProperty(target, INSTALLED, { value: true, configurable: true });
}

installIntegrationUserAgent();
