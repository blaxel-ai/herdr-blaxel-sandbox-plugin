# Keybindings

Herdr's action picker exposes every plugin action without extra setup. Add keybindings only for the actions you use frequently.

Add this example to your Herdr configuration:

```toml
[[keys.command]]
key = "prefix+shift+s"
type = "plugin_action"
command = "blaxel.sandbox.start-agent"
description = "start the configured agent in Blaxel"

[[keys.command]]
key = "prefix+shift+c"
type = "plugin_action"
command = "blaxel.sandbox.reconnect"
description = "reconnect the Blaxel agent"

[[keys.command]]
key = "prefix+shift+a"
type = "plugin_action"
command = "blaxel.sandbox.apply-changes"
description = "apply Blaxel changes locally"

[[keys.command]]
key = "prefix+shift+b"
type = "plugin_action"
command = "blaxel.sandbox.dashboard"
description = "open the Blaxel dashboard"
```

Check and reload the configuration:

```bash
herdr config check
herdr server reload-config
```

See the [Herdr keybinding documentation](https://herdr.dev/docs/configuration/#keybindings) for configuration locations and more examples.
