# Repository guidance

- Verify current Herdr, Blaxel SDK, Blaxel CLI, image, and agent compatibility before changing a pin.
- Treat every Start as a new independent Sandbox and mapping.
- Keep sandbox lifecycle code independent from agent adapters.
- Never upload `.git`, ignored files, dependency trees, environment files, credentials, private keys, or detected secrets.
- Never copy host coding-agent credentials into a sandbox.
- Print the exact Blaxel target and complete filtered upload manifest before the first remote write.
- Revalidate the source pane, target fingerprint, and manifest digest immediately before creation; Start has no approval gate.
- Keep stop and reconnect separate from permanent deletion.
- Require a typed `DELETE` confirmation before replacement or deletion.
- Apply remote changes only after `git apply --check` succeeds.
- Keep the dashboard as the primary lifecycle-management interface.
- Run `npm run check` after every coherent change.
- Run the real Herdr and Blaxel lifecycle before claiming PR readiness.
- Do not commit, push, publish, or open a pull request without Michael's explicit approval.
