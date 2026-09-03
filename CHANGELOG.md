# Changelog

## Unreleased

- Append the product token `herdr-blaxel-sandbox-plugin/<version>` to the Blaxel SDK User-Agent on every Blaxel request so Blaxel can attribute traffic to this plugin. No other header or data is added.
- Add the first Blaxel Sandbox plugin for Herdr.
- Add pinned Codex `0.147.0`, Claude Code `2.1.226`, and OpenCode `1.14.48` adapters with installed-version verification.
- Add persistent remote sessions, immediate safety-filtered Start, checked patch apply, previews, dashboard, and explicit deletion.
- Revalidate the exact Blaxel workspace, runtime settings, upload policy, and file digest before creation without an approval gate.
- Let every Start create an independent Sandbox, including repeated Starts from one pane.
- Add a responsive repository-aware dashboard with complete lifecycle controls.
- Add readable Herdr panes for Start, Apply, info, logs, stop, replace, and delete.
- Keep existing mappings pinned to their original Blaxel workspace and matching repository subdirectory.
- Open the official Blaxel login flow automatically when Start needs account or workspace setup.
- Add direct GitHub installation and automatic Herdr marketplace discovery packaging.
- Keep generated Sandbox names within Blaxel's 49-character limit while preserving the full worktree digest.
- Add live Terminal screenshots of the remote agent workflow and Sandbox dashboard.
