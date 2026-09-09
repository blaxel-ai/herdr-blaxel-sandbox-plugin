import assert from "node:assert/strict";
import test from "node:test";
import { invoices, summarize } from "./invoices.mjs";

test("summarizes paid and outstanding balances in integer cents", () => {
  assert.deepEqual(summarize(invoices), {
    count: 3,
    totalCents: 439550,
    paidCents: 125000,
    openCents: 314550,
  });
});

test("handles an empty ledger", () => {
  assert.deepEqual(summarize([]), {
    count: 0,
    totalCents: 0,
    paidCents: 0,
    openCents: 0,
  });
});

test("refuses invalid amounts, statuses, and overflowing totals", () => {
  for (const cents of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => summarize([{ cents, status: "open" }]),
      /integer cents/,
    );
  }
  assert.throws(() => summarize([{ cents: 1, status: "unknown" }]), /status/);
  assert.throws(
    () =>
      summarize([
        { cents: Number.MAX_SAFE_INTEGER, status: "open" },
        { cents: 1, status: "paid" },
      ]),
    /safe integer/,
  );
});
