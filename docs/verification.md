# Verification

## Local checks

Run from the repository root:

```bash
npm ci
npm run check
npm run test:coverage
npm audit
```

The test suite covers strict configuration, Herdr context, complete-file secret scanning, target-bound upload approval, state locking, stable naming, pinned-workspace routing, installed-version verification, persistent terminal setup, binary patch apply, patch conflict refusal, private preview reconciliation, and manifest and receipt integrity.

## Herdr checks

Use an isolated Herdr session and a temporary Git repository.

Verify:

1. The plugin links without a warning.
2. All actions and panes appear.
3. Start prints the complete provisioning target and eligible upload before any remote write.
4. A changed file or provisioning setting invalidates the prior approval.
5. The matching second invocation continues.
6. Closing and reopening the pane attaches to the same remote `tmux` session.
7. Stop preserves remote files.
8. Delete and Replace require typed confirmation.

## Live Blaxel checks

Use a short-lived test Sandbox and private previews.

Verify:

1. The expected image, workspace, memory, ports, and labels exist.
2. Git, `tmux`, and only the selected agent install successfully.
3. The pinned agent reports the expected version.
4. `bl connect sandbox` opens an interactive terminal.
5. Reconnect returns to the same agent session.
6. A remote source edit applies locally through a checked patch.
7. Repeating Apply reports no new change.
8. A local conflict prevents any apply.
9. A private preview works with a short-lived token.
10. Each built-in agent launches in a real Herdr pane and Herdr identifies it.
11. Final cleanup deletes only the named test Sandboxes, verifies each is missing or `TERMINATED`, and leaves no plugin mapping.

Do not claim an adapter or lifecycle passes until the current run records each result. Public-safe evidence belongs in a hash-verified folder under `verification/receipts`; tokens, workspace identity, Sandbox names, URLs, and absolute local paths do not.
