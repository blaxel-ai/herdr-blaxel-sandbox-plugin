import { pathToFileURL } from "node:url";

export const invoices = [
  {
    id: "INV-1041",
    customer: "Northstar",
    cents: 125000,
    status: "paid",
    due: "2026-08-15",
  },
  {
    id: "INV-1042",
    customer: "Meridian",
    cents: 84550,
    status: "open",
    due: "2026-08-31",
  },
  {
    id: "INV-1043",
    customer: "Summit",
    cents: 230000,
    status: "open",
    due: "2026-09-30",
  },
];

export function summarize(rows) {
  const result = {
    count: rows.length,
    totalCents: 0,
    paidCents: 0,
    openCents: 0,
  };
  for (const row of rows) {
    if (!Number.isSafeInteger(row.cents) || row.cents < 0) {
      throw new Error("Invoice amounts must be nonnegative integer cents");
    }
    if (row.status !== "paid" && row.status !== "open") {
      throw new Error("Invoice status must be paid or open");
    }
    result.totalCents += row.cents;
    result[row.status === "paid" ? "paidCents" : "openCents"] += row.cents;
    if (!Number.isSafeInteger(result.totalCents)) {
      throw new Error("Invoice total exceeds safe integer cents");
    }
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(JSON.stringify(summarize(invoices), null, 2));
}
