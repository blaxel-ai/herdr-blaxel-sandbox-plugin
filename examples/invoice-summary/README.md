# Invoice summary

A small Node.js project for trying the Herdr plugin's remote edit, test, reconnect, and apply workflow. It uses a fixed invoice ledger and integer cents, with no dependencies or application credentials. You need Node.js 22 or newer.

## Run locally

From this directory:

```bash
npm test
npm start
```

The starting summary is:

```json
{
  "count": 3,
  "totalCents": 439550,
  "paidCents": 125000,
  "openCents": 314550
}
```

## Work on it in Herdr

Install and configure the plugin using the [main README](../../README.md#quick-start), including Blaxel login and authentication for your selected coding agent. The example itself needs no `.env` file.

From the plugin repository root, copy only this project into a fresh Git repository so Start uploads the example rather than the plugin source:

```bash
example_dir="$(mktemp -d "${TMPDIR:-/tmp}/herdr-invoice-summary.XXXXXX")"
cp -R examples/invoice-summary/. "$example_dir/"
cd "$example_dir"
git init
git add .
git -c user.name="Herdr Example" -c user.email="example@localhost" commit -m "Invoice summary baseline"
npm test
```

Open this directory as a workspace in Herdr. From a local shell pane in that workspace, run:

```bash
herdr plugin action invoke start-agent --plugin blaxel.sandbox
```

Give the remote agent this task:

> Add an `overdueCents` field to the summary, using an explicit `asOf` date argument. An invoice is overdue only when it is open and its due date is earlier than `asOf`. For `2026-09-08`, the sample ledger should report `84550` overdue cents. Keep the existing totals unchanged. Add tests for paid invoices, invoices due on the cutoff date, and an empty ledger. Run `npm test` and `npm start`.

Close the agent pane and use the plugin dashboard's **Connect** action to reconnect to the same session. When the change is ready, choose **Review and apply** in the dashboard, inspect the patch, and approve it. Back in the local example directory, run:

```bash
git diff
npm test
npm start
```

Finish by deleting the example's Sandbox from the dashboard and typing `DELETE` when prompted. Stopping the agent preserves the Sandbox; it does not delete it.

This command-line example has no web server or preview port. Its tests also run as part of the plugin repository's `npm run check`.
