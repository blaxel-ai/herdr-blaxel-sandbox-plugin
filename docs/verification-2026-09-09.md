# Herdr × Blaxel verification: 2026-09-09

This record covers the Pi and interface-polish candidate based on plugin commit `21c8f7f68426219ee98419f6bb5ba6e3d16d24d9`. It records local artifact proof; hosted checks, merge, and CLI release have separate GitHub status.

## Four-tool live verification

| Tool        | Pinned CLI | Test model            | Real edit and example tests | Complete lifecycle and cleanup |
| ----------- | ---------- | --------------------- | --------------------------- | ------------------------------ |
| Codex       | 0.147.0    | gpt-5.4-mini          | PASS                        | PASS                           |
| Claude Code | 2.1.226    | claude-haiku-4-5      | PASS                        | PASS                           |
| OpenCode    | 1.14.48    | openai/gpt-5.4-mini   | PASS                        | PASS                           |
| Pi          | 0.73.1     | openai / gpt-5.4-mini | PASS                        | PASS                           |

Every final run uses Herdr 0.9.0, pinned SDK 0.3.11, and a disposable sandbox with a 30-minute idle-deletion policy. Each actual coding tool receives a prompt through its Herdr terminal, edits the example itself, and produces an exported function whose result and repository tests are checked independently. Provider keys enter through process environment and adapter-declared encrypted secrets; host credential files are never copied.

Each run also checks persisted tool selection, filtered upload, installed version, Herdr detection, identical tmux identity on reconnect, private-preview anonymous refusal and authenticated success, unknown-route 404, canceled/conflicting/approved/repeated Apply, Stop preserving files, incorrect/correct typed deletion, and confirmed sandbox/mapping cleanup. No sandbox or mapping remains from these tests.

Codex's native migration prompt and Claude Code's native setup prompts are handled only inside the isolated test profile. OpenCode readiness uses its real composer. These API-key tests do not establish every OAuth/account-login path or additional model provider.

## Interface and local checks

- `npm run check`: 75 tests pass on Node 22.22.3 and 26.3.0, including formatting, lint, and manifest validation.
- Herdr 0.8.0 and 0.9.0: isolated registration, installed dependencies, runnable example, tool chooser, persisted Pi selection, Escape dismissal, and dashboard pass.
- Shared dialog checks cover dimming, focus, Escape, scrolling, terminal cell widths, grapheme Backspace, visible long-input tails, and refusal of hidden confirmation below 40 × 12 cells.
- Wrapped review content is cached between keystrokes and invalidated on output or width changes. Patches exceeding 1 MiB are refused before download or local apply. Accepted patches are shown completely, and every export has its own temporary remote file.
- Connection completion only changes the mapping owned by that pane, preserving newer reconnects and Stop/Delete states. Standalone operation failures retain readable dialogs and exit unsuccessfully after dismissal.

Pi's npm installation uses publication cutoff `2026-09-09T18:00:00Z` after a fresh upstream AWS SDK dependency resolution failed. Fresh Pi installs and complete model/lifecycle runs pass with that cutoff. It is a verified publication snapshot, not a full dependency lockfile.

## Screenshots

The README images are real Herdr clients recorded through asciinema PTYs and rendered with agg resvg at font size 20, line height 1.2, and the `github-dark` palette. The frame is selected at 75% of the adjusted timeline and exported as PNG. No input recording or additional environment capture is enabled. Every delivered PNG was visually inspected.

| Image                | Terminal cells | PNG pixels |
| -------------------- | -------------- | ---------- |
| Dashboard            | 112 × 24       | 1368 × 600 |
| Four-tool chooser    | 112 × 28       | 1368 × 696 |
| Pi invoice task      | 112 × 34       | 1368 × 840 |
| Checked patch review | 112 × 34       | 1368 × 840 |

The isolated capture profile uses Herdr's native `terminal` theme, a 22-column sidebar, visible pane borders, sidebar background `#141a23`, active/selected rows `#25334a`, blue `#7aa2f7`, and accent `#7dcfff`. Pi uses its native dark theme; Ctrl+T collapses thinking blocks. Its actual task adds `overdueTotal(rows, asOf)` and runs the example tests.

The old gray striping had two causes: tmux reduced Pi's native `#283228` success panels to indexed gray, and resvg at line height 1.25 introduced thin row gaps. The shared wrapper now advertises RGB and hides the redundant tmux status bar. The new recording contains RGB `40;50;40`, and rendering at 1.2 removes the row gaps. Native Pi tool cards remain visible.

The accepted images were captured before the final input, state, and bounded-review fixes, at runtime digest `2495f0f7070d55c78ed92f3ea3cc88ed8929e6fc5e362ca1089b511e8bc38a4b`. Their visible layouts remain representative. Raw recordings, image hashes, earlier failed attempts, and the capture manifest are retained locally under `.local/aesthetics/`; final recordings are in `final-6/`.

## CLI dependency

Released Blaxel CLI 0.1.110 can take a terminal token from the saved default workspace even when `--workspace` selects another workspace for API requests. Two fresh captures and a manual reconnect failed with `websocket: bad handshake` after that default token expired, although the selected workspace token was valid. All failed runs were cleaned up.

[Toolkit PR #390](https://github.com/blaxel-ai/toolkit/pull/390) resolves the selected workspace and reuses the refreshing token helper. The final four-tool runs use a local build of that correction on toolkit main; this is distinct from released CLI 0.1.110. CLI regression tests, `go test ./cli/...`, lint, and build pass. The correction must be released before claiming the multi-workspace terminal fix is available in the installed CLI. The troubleshooting guide documents the current login workaround.

## Artifact identity and publication checks

Final runtime and live-harness SHA256: `72b6641f47c3e8b108546d8037a63ab547a59647aec05ffe53b7bbeca4e99db6`.

Hash sorted relative paths, adding the UTF-8 path, NUL, exact file bytes, and NUL for each file:

```text
herdr-plugin.toml
package-lock.json
package.json
scripts/herdr-smoke.py
scripts/live-probe.mjs
src/action.mjs
src/actions.mjs
src/adapters.mjs
src/agent-pane.mjs
src/config.mjs
src/confirmation-pane.mjs
src/constants.mjs
src/context.mjs
src/dashboard-model.mjs
src/dashboard.mjs
src/herdr.mjs
src/integration-user-agent.mjs
src/login-pane.mjs
src/manifest.mjs
src/mappings.mjs
src/operation-pane.mjs
src/patch.mjs
src/previews-pane.mjs
src/process.mjs
src/result.mjs
src/sandbox.mjs
src/start-pane.mjs
src/start.mjs
src/state.mjs
src/terminal-ui.mjs
```

Final local pass and cleanup logs are retained under `.local/pr-readiness/`. A fresh GitHub install must use the pushed candidate commit; a linked checkout does not establish that gate. Hosted CI checks Node 22/24 and minimum/latest Herdr on Linux/macOS. The scheduled live matrix requires its dedicated GitHub environment credentials and does not make provider model calls.

The [Herdr tutorial PR](https://github.com/blaxel-ai/docs/pull/778) is updated alongside this candidate with the four-tool chooser and refreshed static images. Verify the public tutorial, navigation, and generated docs index after its merge. CLI release, plugin merge/install proof, hosted checks, and tutorial publication remain distinct evidence gates.
