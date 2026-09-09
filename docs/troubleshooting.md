# Troubleshooting

## Herdr does not show the plugin

Run:

```bash
herdr plugin link /absolute/path/to/herdr-blaxel-sandbox-plugin
herdr plugin list
herdr plugin action list --plugin blaxel.sandbox
```

Use Herdr `0.8.0` or newer. Local links do not run the manifest build command, so run `npm ci` first.

## Blaxel is not connected

Start opens **Connect Blaxel** automatically when login or workspace selection is needed. Complete `bl login`; Start continues automatically. You can also open **Connect Blaxel workspace** yourself and check:

```bash
bl workspaces
```

Set `workspace` in `config.json` when the default workspace is not correct.

## Start says the snapshot changed

The target, file digest, or source pane changed between preparation and the first remote write. Run Start again.

## A safe file is excluded

Check Git ignore rules first:

```bash
git check-ignore -v path/to/file
```

Use one exact path in `allowSensitivePaths` only when the file is safe to upload. The setting cannot allow a directory or pattern.

## An agent asks for authentication

Complete the agent login inside the Sandbox pane. The plugin does not copy credentials from your computer.

## Why OpenCode is not the latest release

OpenCode `1.14.48` is the newest version verified to keep its interactive session running in Blaxel. Newer releases embed Bun `1.3.14`, which currently crashes in this Sandbox runtime. Update the pin only after a full live lifecycle passes.

The plugin uses the Debian-based `blaxel/ts-app:latest` image for all four adapters. Changing the image requires a new preview and a complete four-adapter live verification.

## Terminal connection reports `websocket: bad handshake`

Blaxel CLI `0.1.110` can use the saved default workspace's token for a terminal connection even when the plugin selects another workspace. An expired default token then prevents the terminal from opening while Sandbox API operations still succeed.

Until the CLI correction is released, sign in to the workspace selected in the plugin with `bl login <workspace>` and reconnect. This changes the CLI's current workspace. The [verification record](verification-2026-09-09.md) distinguishes the released CLI from the locally verified correction.

## Reconnect says the Sandbox is missing

The Sandbox expired or someone deleted it. Use Replace to create a new Sandbox from a fresh filtered upload.

## Apply reports a conflict

The plugin changed no local file. Commit, stash, or reconcile the local changes. Then run Apply again.

Do not force-apply the exported patch. Review it when the local and remote work diverged.

## The agent stopped but files still exist

This is expected. Stop ends the remote `tmux` session. Use Reconnect to start the agent again. Use Delete only when you want to remove the Sandbox.

## A preview does not appear

Confirm that the application listens on `0.0.0.0`, not only `127.0.0.1`. Confirm that its port exists in `previewPorts`.

Keep `publicPreviews` off unless the application is safe for public access.

## The dashboard has no Sandboxes

Press **n** from a Git worktree to create the first Sandbox. Press **t** to choose Codex, Claude Code, OpenCode, or Pi first. No shell alias is required.

## A dialog is longer than the screen

Use **Page Up**, **Page Down**, or the arrow keys to scroll. Apply displays the complete checked patch before asking for approval. **Escape** cancels the pending prompt. While an operation is running, the dialog retains focus until it reports its result.

## Claude Code asks whether to use an API key

Confirm the key in Claude Code's own prompt if you intend to use the provider key you supplied. Folder trust and coding-tool permission prompts remain native to each tool.

## Pi asks for a provider

Use Pi's `/login` or `/model` command inside the Sandbox. For an OpenAI API key, an example `agentArgs` value is `["--provider", "openai", "--model", "gpt-5.4-mini"]`. A separate sandbox retains Pi's own configuration and conversation files until deletion.

## Codex offers a replacement model

Codex may show its own model-migration menu before the input prompt. Complete that menu before sending a task. If you explicitly chose a model that remains available to your API account, choose **Use existing model** to retain it.

## Pi installation reports an unavailable AWS SDK dependency

Pi 0.73.1 declares dependency ranges that can select newly published AWS SDK packages. A capture run on 2026-09-09 found that resolution requested the unavailable `@aws-sdk/core@^3.978.0`. The Pi adapter now uses npm’s [publication cutoff](https://docs.npmjs.com/cli/v11/using-npm/config/#before), `2026-09-09T18:00:00Z`, to resolve the earlier working dependency set. Advance this cutoff only after a fresh installation and live Pi walkthrough pass; it is not an npm lockfile.
