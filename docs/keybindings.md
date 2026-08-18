# Keybindings

Every plugin action is available through `herdr plugin action invoke`. Add keybindings only for the actions you use frequently.

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

The dashboard is the complete management surface. Run `sbx list` if you installed the optional function from the README, select with arrows or `j`/`k`, then use `Enter`/`c` to connect, `n` to create another Sandbox for the selected repository, `a` to Apply, `i` for info, `l` for logs, `p` for previews, `s` to stop, `x` to replace, `d` to delete, `r` to refresh, and `q` to close.
