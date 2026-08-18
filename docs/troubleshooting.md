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

Start opens **Connect Blaxel** automatically when login or workspace selection is needed. Complete `bl login`, then run Start again. You can also open **Connect Blaxel workspace** yourself and check:

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

The plugin uses the Debian-based `blaxel/ts-app:latest` image for all three adapters. Changing the image requires a new preview and a complete three-adapter live verification.

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
