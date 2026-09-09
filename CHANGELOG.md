# Changelog

## Unreleased

- Keep long prompts and Unicode input readable, preserve newer connection state, and bound complete patch reviews to 1 MiB with independent temporary exports.

- Preserve truecolor in remote coding terminals, hide the redundant tmux status bar, and give shared dialogs rounded borders and colored patch reviews.
- Refresh Herdr screenshots from genuine terminal recordings and hold Pi dependency resolution to its verified publication cutoff after an upstream AWS SDK resolution failure.

- Add pinned Pi support alongside Codex, Claude Code, and OpenCode, with one adapter registry for configuration and saved state.
- Add dashboard tool and workspace selection, creation from an empty dashboard, and shared dialogs with a dimmed backdrop, scrolling, Escape cancellation, and Unicode-aware layout.
- Show changed code before Apply, preserve active provisioning during dashboard cleanup, verify Stop results, and check CLI login before provisioning a configured workspace.
- Add parameterized live walkthroughs with optional real model editing for each tool; keep provider credentials out of unattended CI by default.

- Add `llms.txt`, contributor maintenance guidance, and a compatibility table.
- Exercise minimum/latest Herdr on Linux and macOS, check Node.js 22/24, and add weekly dependency updates and an opt-in disposable live lifecycle workflow.
- Normalize Sandbox names after truncation so custom prefixes cannot produce consecutive hyphens rejected by Blaxel.

- Add a dependency-free invoice summary example with tests and a Herdr edit/reconnect/apply walkthrough.
- Append the product token `herdr-blaxel-sandbox-plugin/<version>` to this plugin's authenticated Blaxel SDK requests so Blaxel can attribute traffic to the integration. No other header or data is added; separate Blaxel CLI requests keep the CLI User-Agent.
- Refresh dependencies and override vulnerable TOML and YAML parsers with patched versions.
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
