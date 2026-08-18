# Configuration

The default configuration uses Codex, your current Blaxel CLI workspace, the `blaxel/ts-app:latest` image, 4 GB of memory, private previews, and a seven-day idle deletion policy. You do not need a configuration file for the default path.

## Find the configuration directory

Run:

```bash
herdr plugin config-dir blaxel.sandbox
```

Create `config.json` in the returned directory. Herdr keeps plugin configuration separate from the installed plugin files.

## Example

Every key is optional:

```json
{
  "agent": "codex",
  "agentArgs": [],
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
  "maxUploadBytes": 104857600
}
```

Unknown keys and invalid values stop the action with a clear error.

## Settings

| Setting               | Default                        | Purpose                                                                               |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `agent`               | `codex`                        | Selects `codex`, `claude-code`, or `opencode`.                                        |
| `agentArgs`           | `[]`                           | Appends arguments to the selected agent command.                                      |
| `workspace`           | `null`                         | Uses a specific Blaxel workspace. `null` uses the current CLI workspace.              |
| `region`              | `null`                         | Uses a specific Blaxel region. `null` lets Blaxel choose.                             |
| `image`               | `blaxel/ts-app:latest`         | Selects the Sandbox image.                                                            |
| `memory`              | `4096`                         | Sets Sandbox memory in megabytes.                                                     |
| `remoteRoot`          | `/workspace`                   | Sets the repository path inside the Sandbox. It must be `/workspace` or a child path. |
| `idleDelete`          | `7d`                           | Deletes an idle Sandbox after the given duration.                                     |
| `sandboxNamePrefix`   | `herdr`                        | Prefixes generated Sandbox names.                                                     |
| `previewPorts`        | `3000`, `4173`, `5173`, `8000` | Declares application ports for previews.                                              |
| `publicPreviews`      | `false`                        | Makes preview URLs public when set to `true`.                                         |
| `excludedPaths`       | `[]`                           | Excludes extra repository-relative paths from upload.                                 |
| `allowSensitivePaths` | `[]`                           | Allows exact files that the safety filter would otherwise exclude.                    |
| `maxFiles`            | `10000`                        | Limits the number of uploaded files.                                                  |
| `maxFileBytes`        | `10485760`                     | Limits each uploaded file to 10 MiB.                                                  |
| `maxUploadBytes`      | `104857600`                    | Limits the complete upload to 100 MiB.                                                |

## Workspace behavior

When `workspace` is `null`, the plugin resolves your current Blaxel CLI workspace before provisioning. It saves that exact workspace with the Sandbox mapping. Switching your CLI workspace later cannot redirect an existing mapping.

Run **Connect Blaxel workspace** when you want to sign in or change the active account before starting an agent.

## Files and credentials

Do not put tokens in `config.json` or `agentArgs`. The plugin never copies host coding-agent sessions, config directories, cookies, or credential files into a Sandbox.

For Codex, a present `OPENAI_API_KEY` is sent as a Blaxel encrypted secret and used by `codex login --with-api-key` inside the Sandbox. OpenCode receives the same encrypted variable and uses it through its OpenAI provider. For Claude Code, a present `ANTHROPIC_API_KEY` is sent as a Blaxel encrypted secret. Only the selected adapter's declared variable is sent, its value is never printed or stored in plugin state, and interactive authentication remains available when no key is present.

The upload starts from Git tracked and untracked files. It excludes Git-ignored paths, `.git`, dependencies, environment files, common credentials, private keys, cloud configuration, Terraform state, symlinks, and recognized token formats.

`allowSensitivePaths` accepts exact repository-relative files. Add a file only after you have reviewed its contents and confirmed that the remote agent needs it.

## Previews

Private previews are the default. Their short-lived access token appears only in the Herdr popup. Set `publicPreviews` to `true` only when the application is safe for anyone with the URL to access.
