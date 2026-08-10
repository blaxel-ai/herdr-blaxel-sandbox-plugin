# Contributing

Thanks for improving the Blaxel Sandbox plugin for Herdr.

## Before you start

Use an issue for a bug report or a focused feature proposal. For security problems, follow [SECURITY.md](SECURITY.md) instead.

Read the [design and lifecycle](docs/design.md) before changing Sandbox ownership, upload filtering, persistent sessions, patch handling, or deletion behavior.

## Local setup

```bash
npm ci
herdr plugin link /absolute/path/to/herdr-blaxel-sandbox-plugin
herdr plugin list
herdr plugin action list --plugin blaxel.sandbox
```

## Checks

Run the complete local suite before you open a pull request:

```bash
npm run check
npm run test:coverage
npm audit
```

For runtime changes, test the affected flow in Herdr with a temporary Blaxel Sandbox. Record what you verified and remove that Sandbox afterward.

## Pull requests

Keep each pull request focused. Explain the user-facing change, its verification, and any compatibility impact.

Do not commit credentials, private source, machine-specific paths, temporary fixtures, or generated plugin state.
