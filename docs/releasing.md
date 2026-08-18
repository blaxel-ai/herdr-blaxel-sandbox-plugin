# Releasing

1. Confirm current Herdr, Blaxel CLI, Blaxel SDK, image, and agent versions.
2. Update pinned versions and tests when required.
3. Run every local check in `docs/verification.md`.
4. Run one complete live lifecycle for each built-in agent.
5. Record the live results and confirm exact test-Sandbox cleanup.
6. Review the full Git diff and remove test data.
7. Confirm no token, local path, private source, or generated state is tracked.
8. Update `version` in `package.json` and `herdr-plugin.toml` together.
9. Update `CHANGELOG.md` with verified user changes.
10. Get explicit approval before any commit, push, pull request, tag, or release.

The public repository must keep the `herdr-plugin` GitHub topic so Herdr can index it automatically. No separate marketplace submission or upstream pull request is required.
