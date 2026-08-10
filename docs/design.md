# Design

## Boundary

Herdr owns the local terminal, pane context, and user actions. Blaxel owns the remote Sandbox, files, processes, and previews.

The plugin uses public Herdr plugin actions and panes. It does not require a Herdr core change.

## Identity

A mapping connects one local Git worktree, one agent kind, one Herdr source pane, and one Blaxel Sandbox.

Sandbox names use a short readable prefix plus a stable hash. A persisted UUID identifies the mapping and remote `tmux` session.

The mapping also freezes the resolved Blaxel workspace. Existing mappings continue to use their original workspace even if the local CLI default changes.

## Lifecycle

```text
preview upload
  -> approve unchanged target and digest
  -> create Sandbox
  -> upload checked files
  -> install one pinned agent
  -> verify the installed version
  -> create Git baseline
  -> open connected Herdr pane
```

The plugin records each lifecycle change. A setup failure keeps the mapping and Sandbox name for recovery.

## Terminal persistence

The default `blaxel/ts-app:latest` image supplies a Debian-based Node 22 runtime. The Sandbox starts with `/bin/sh`, so setup commands work before the plugin uploads its files. Interactive shells read a small `ENV` bootstrap that starts `/usr/local/bin/herdr-blaxel-shell`. The wrapper attaches to one named `tmux` session and starts the configured agent in the matching repository subdirectory when no session exists.

The Herdr pane runs the official `bl connect sandbox` command. Closing that pane disconnects the client. It does not stop the remote session.

## Change transfer

The initial upload creates a remote Git baseline. Each local apply exports a binary patch from the last applied remote commit to a new remote snapshot.

The plugin checks the patch against the local worktree. It applies only a clean patch. It then advances the saved remote commit. This makes repeat calls incremental.

## Trust model

The local Blaxel CLI and SDK use the user's current Blaxel identity. The plugin does not store a Blaxel token.

Workspace source files can contain secrets. The plugin filters names, paths, ignored files, symlinks, and high-confidence secret content before upload. The user approves the exact resulting digest.

The approval also covers the resolved workspace, agent package, image, region, memory, expiry, preview access, remote root, and upload policy. Any change requires a new preview.

Agent authentication is separate. The user completes it inside the remote terminal. Host agent credentials never enter the Sandbox.

## Permanent actions

Stop preserves the Sandbox and files. Delete removes them. Replace deletes and creates a new Sandbox.

Delete and replace use a popup with a typed `DELETE` value. Background actions cannot bypass it.
