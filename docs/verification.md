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
