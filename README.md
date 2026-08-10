# Blaxel Sandbox for Herdr

Run Codex, Claude Code, or OpenCode in a persistent Blaxel Sandbox from a Herdr pane.

Herdr stays on your computer. The coding agent runs in Blaxel. A persistent `tmux` session keeps the agent alive when the local terminal disconnects.

## What ships

- One Blaxel Sandbox for each local worktree and agent pair.
- Codex `0.147.0`, Claude Code `2.1.226`, and OpenCode `1.14.48` adapters.
- An exact Blaxel target and upload preview before any remote resource or file write.
- Reconnect, stop, output, patch apply, previews, replacement, and deletion actions.
- A dashboard for every Sandbox tracked by the plugin.
- Private previews by default. Public previews require explicit configuration.

## Requirements

- macOS or Linux
- Herdr `0.8.0` or newer
- Node.js `22` or newer
- Git
- Blaxel CLI `0.1.108` or newer
- A Blaxel account and workspace

## Install

```bash
herdr plugin install blaxel-ai/herdr-blaxel-sandbox-plugin
```

Herdr shows the source and build commands once before installing. Use `--yes` only when you already trust this repository.

For local development:

```bash
npm ci
herdr plugin link /absolute/path/to/herdr-blaxel-sandbox-plugin
herdr plugin list
herdr plugin action list --plugin blaxel.sandbox
```

Start uses the current Blaxel CLI workspace automatically. If the CLI is signed out or has no current workspace, Start opens the official `bl login` flow. Sign in, then run Start again. **Connect Blaxel workspace** is also available when you want to sign in or switch accounts first.

## Start an agent

1. Open a Git worktree in Herdr.
2. Run **Start configured agent in Blaxel**.
3. Review the workspace, agent, image, settings, exact files, total size, and digest.
4. Run the same action again within ten minutes.
5. Use the new Herdr pane as the remote agent terminal.

The second action approves only the unchanged target and digest. A file or provisioning-setting change creates a new preview and needs a new second action.

You can also invoke an action from the Herdr CLI:

```bash
herdr plugin action invoke start-agent --plugin blaxel.sandbox
```

Context actions require a focused Herdr pane. Keybindings provide the normal workflow:

```toml
[[keys.command]]
key = "prefix+shift+s"
type = "plugin_action"
command = "blaxel.sandbox.start-agent"
description = "start the configured agent in Blaxel"

[[keys.command]]
key = "prefix+shift+c"
type = "plugin_action"
command = "blaxel.sandbox.reconnect"
description = "reconnect the Blaxel agent"

[[keys.command]]
key = "prefix+shift+a"
type = "plugin_action"
command = "blaxel.sandbox.apply-changes"
description = "apply Blaxel changes locally"

[[keys.command]]
key = "prefix+shift+b"
type = "plugin_action"
command = "blaxel.sandbox.dashboard"
description = "open the Blaxel dashboard"
```

Run `herdr config check` and `herdr server reload-config` after you add keybindings.

## Configure

Find the Herdr-managed config directory:

```bash
herdr plugin config-dir blaxel.sandbox
```

Create `config.json` there. Every key is optional:

```json
{
  "agent": "codex",
  "workspace": null,
  "region": null,
  "image": "blaxel/ts-app:latest",
  "memory": 4096,
  "remoteRoot": "/workspace",
  "idleDelete": "7d",
  "sandboxNamePrefix": "herdr",
  "previewPorts": [3000, 4173, 5173, 8000],
  "publicPreviews": false,
  "excludedPaths": ["private-fixtures/"],
  "allowSensitivePaths": [],
  "maxFiles": 10000,
  "maxFileBytes": 10485760,
  "maxUploadBytes": 104857600,
  "uploadApprovalSeconds": 600
}
```

Use `codex`, `claude-code`, or `opencode` for `agent`. Unknown keys and invalid values fail closed.

When `workspace` is `null`, the plugin resolves the current Blaxel CLI workspace before the preview. It saves that exact workspace with the Sandbox mapping, so switching your CLI workspace later cannot redirect an existing mapping. `remoteRoot` must be `/workspace` or a path below it.

Do not place tokens in `config.json`. The plugin never copies host coding-agent credentials. Sign in to the agent inside its Sandbox when needed.

## File and change safety

The upload starts from Git tracked and untracked files. It excludes Git-ignored paths, `.git`, dependencies, environment files, credentials, private keys, cloud configuration, Terraform state, symlinks, and recognized token formats.

`allowSensitivePaths` accepts exact repository-relative files. Use it only after direct review.

Remote edits stay in the Sandbox until you run **Apply Blaxel changes locally**. The plugin exports a binary Git patch. It runs `git apply --check --binary` before it changes the local worktree. A conflict changes nothing.

**Stop Blaxel agent** ends only the remote `tmux` session. It preserves the Sandbox filesystem. Replacement and deletion need a typed `DELETE` confirmation.

## Preview policy

The plugin declares the configured ports when it creates the Sandbox. **Open Blaxel previews** lists current preview URLs.

Private previews are the default. Their short-lived access token appears only in the popup. Set `publicPreviews` to `true` only when the application is safe for public access.

## Development

```bash
npm ci
npm run check
npm run test:coverage
npm audit
```

See [design](docs/design.md), [verification](docs/verification.md), [troubleshooting](docs/troubleshooting.md), and [release steps](docs/releasing.md).

## Status

Version `0.1.0` is ready to install from this public repository. The checked live receipt is in [`verification/receipts`](verification/receipts).
