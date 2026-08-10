# Contributing

Thanks for improving the Blaxel Sandbox plugin for Herdr.

Before opening a pull request:

1. Keep the change focused on the plugin and its documented lifecycle.
2. Do not commit credentials, private source, local paths, or generated plugin state.
3. Run `npm ci`, `npm run check`, `npm run test:coverage`, and `npm audit`.
4. For runtime changes, test the affected flow in Herdr with a temporary Blaxel Sandbox and remove that Sandbox afterward.
5. Explain the user-facing behavior, verification, and any compatibility change in the pull request.

Security reports do not belong in public issues. Follow [SECURITY.md](SECURITY.md).
