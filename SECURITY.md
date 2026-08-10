# Security

Report a suspected vulnerability through Blaxel's private security process. Do not open a public issue with tokens, private source, account details, or an active exploit. Use the private vulnerability-reporting link in this repository's Security tab when available; otherwise contact the Blaxel security owner through the current internal process.

## Scope

Security-sensitive areas include upload filtering, secret detection, path containment, local state, Blaxel identity, remote process execution, preview access, patch application, and permanent deletion.

The plugin does not copy host agent credentials. It blocks common secret files and token formats. These controls reduce risk but do not replace user review of the upload preview.
