# Verification

## Local checks

Run from the repository root:

```bash
npm ci
npm run check
npm run test:coverage
npm audit
```

The test suite covers strict configuration, Herdr context, complete-file secret scanning, target-bound Start revalidation, state locking, unique naming, pinned-workspace routing, installed-version verification, persistent terminal setup, binary patch apply, patch conflict refusal, private preview reconciliation, and dashboard behavior.

## Herdr checks

Run the automated registration, installed dependency, runnable example, and dashboard checks against each host version:

```bash
python3 scripts/install-test-tools.py --herdr 0.8.0 --directory /tmp/herdr-minimum
python3 scripts/herdr-smoke.py --herdr /tmp/herdr-minimum/herdr
python3 scripts/install-test-tools.py --herdr latest --directory /tmp/herdr-current
python3 scripts/herdr-smoke.py --herdr /tmp/herdr-current/herdr
```

The installer verifies SHA256 digests from official GitHub release metadata. Tests isolate config, state, sockets, and panes in their own named session. They do not replace the installed Herdr binary or touch existing sessions.

Use an isolated Herdr session and a temporary Git repository.

Verify:

1. The plugin links without a warning.
2. All actions and panes appear.
3. Start immediately provisions while showing the complete target and eligible upload.
4. A changed file or provisioning setting stops Start before the first remote write.
5. Start requires no approval or second invocation.
6. Closing and reopening the pane attaches to the same remote `tmux` session.
7. Stop preserves remote files.
8. Delete and Replace require typed confirmation.

## Live Blaxel checks

With the Blaxel CLI installed and authenticated, select an approved disposable test workspace and run:

```bash
export BL_WORKSPACE=your-test-workspace
python3 scripts/herdr-smoke.py --herdr /tmp/herdr-current/herdr --live
```

Add `--install-ref <full-40-character-commit>` to verify a fresh GitHub installation and its install-time `npm ci --omit=dev` build. The commit must already be pushed. Without this flag, the test links the current local checkout.

The automated test launches pinned Codex in real Herdr, verifies the same remote tmux identity after disconnect/reconnect, makes a deterministic invoice edit, checks the private preview with and without a token, verifies an unknown route, exercises canceled/conflicting/approved/repeated Apply, checks Stop preserves files, and exercises incorrect/correct typed deletion. Operation panes use split placement so headless Herdr can expose their terminal contents; the same production pane entrypoints handle approval and deletion. Preview terminal contents and bearer URLs are never printed. Cleanup runs in `finally`; sandboxes also have a 30-minute idle TTL. Interrupted cleanup must be treated as a failed run and checked in the test workspace before retrying.

This smoke test deliberately removes model-provider keys and does not make a model call. It verifies the plugin lifecycle and Codex launch, including its sign-in screen. A real prompted tutorial walkthrough and checks for the other agent adapters remain separate release evidence.

### Scheduled live test setup

The `CI` workflow runs unit/compatibility checks on pull requests, pushes, and Mondays. After merge, the Monday run also executes the live test. `workflow_dispatch` can request it manually on `main`. Live credentials are never supplied to a pull request or non-main branch.

Create the GitHub environment `herdr-live-smoke` with a dedicated test-workspace service-account `BL_API_KEY` secret and a `BL_WORKSPACE` environment variable. Use a dedicated service account in an otherwise isolated test workspace. The service-account creation API grants workspace-admin access by default, so this credential must not share a workspace with production workloads. Workspace creation under an existing account requires account-owner or account-admin access. Restrict the GitHub environment to protected branches, with `main` protected; the workflow also explicitly restricts credentialed jobs to `main`. Do not reuse personal CLI login tokens. Missing configuration fails the live job explicitly. Configure these credentials through the approved team process; adding the workflow alone does not activate a successful hosted live test.

After an approved merge, verify the public tutorial, navigation, overview card, generated docs `llms.txt`, and the Herdr marketplace entry. A PR preview or a successful fresh install of a candidate commit is not proof of publication.

Use a short-lived test Sandbox and private previews.

Verify:

1. The expected image, workspace, memory, ports, and labels exist.
2. Git, `tmux`, and only the selected agent install successfully.
3. Provider keys, when present, appear only as encrypted environment declarations and no value appears in plugin output or state.
4. The pinned agent reports the expected version.
5. `bl connect sandbox` opens an interactive terminal.
6. Reconnect returns to the same agent session.
7. A remote source edit appears in a readable patch summary and applies only after approval.
8. Repeating Apply reports no new change.
9. A local conflict prevents any apply.
10. A private preview works with a short-lived token.
11. Each built-in agent launches in a real Herdr pane and Herdr identifies it.
12. Final cleanup deletes only the named test Sandboxes, verifies each is missing or `TERMINATED`, and leaves no plugin mapping.

Do not claim an adapter or lifecycle passes until the current run records every required phase and cleanup result. Keep credentials, workspace identity, Sandbox names, private URLs, absolute local paths, and repository contents out of public evidence.
