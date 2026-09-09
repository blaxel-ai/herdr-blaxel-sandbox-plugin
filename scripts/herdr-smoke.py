#!/usr/bin/env python3
"""Exercise real Herdr in an isolated profile; --live creates disposable Blaxel resources."""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--herdr", default="herdr")
parser.add_argument("--install-ref", help="Fresh GitHub install of this exact commit instead of linking")
parser.add_argument("--live", action="store_true")
parser.add_argument("--agent", default="codex", help="Coding tool from the plugin adapter registry")
parser.add_argument("--agent-args", default="[]", help="JSON array of tool arguments")
parser.add_argument("--model-test", action="store_true", help="Use an approved provider key for a real file-editing task; requires --live")
args = parser.parse_args()
assert not args.model_test or args.live, "--model-test requires --live"
repo = Path(__file__).resolve().parent.parent
binary = shutil.which(args.herdr)
assert binary, "Herdr binary is required"
if args.live:
    assert os.environ.get("BL_WORKSPACE"), "Set BL_WORKSPACE to an approved test workspace"
    assert shutil.which("bl"), "Blaxel CLI is required"


def wait_for(check, label, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.3)
    raise AssertionError(f"Timed out: {label}")


# macOS's default per-user temp path can exceed the Unix socket path limit.
with tempfile.TemporaryDirectory(prefix="herdr-smoke-", dir="/tmp") as temporary:
    base = Path(temporary)
    env = dict(os.environ)
    # This deterministic lifecycle probe launches the CLI but does not call a model.
    if not args.model_test:
        env.pop("OPENAI_API_KEY", None)
        env.pop("ANTHROPIC_API_KEY", None)
    for key in list(env):
        if key.startswith("HERDR_") or key.startswith("BLAXEL_HERDR_"):
            del env[key]
    for name, directory in [("XDG_CONFIG_HOME", "config"), ("XDG_STATE_HOME", "state"), ("XDG_RUNTIME_DIR", "runtime")]:
        env[name] = str(base / directory)
        (base / directory).mkdir(mode=0o700)
    # Keep the matching client on PATH for pane commands; never change the host installation.
    (base / "bin").mkdir()
    (base / "bin/herdr").symlink_to(binary)
    env["PATH"] = f"{base / 'bin'}:{env['PATH']}"
    config = base / "config/herdr"
    config.mkdir()
    (config / "config.toml").write_text('onboarding = false\n[terminal]\ndefault_shell = "/bin/sh"\nshell_mode = "non_login"\n[update]\nversion_check = false\nmanifest_check = false\n')
    cli = [binary, "--session", "smoke"]

    def run(command, **kwargs):
        result = subprocess.run(command, env=env, text=True, capture_output=True, timeout=180, **kwargs)
        assert result.returncode == 0, f"Command failed: {command[0]} {command[1:3]} (exit {result.returncode})"
        return result.stdout

    def herdr(*command):
        return run([*cli, *command])

    def result(*command):
        response = json.loads(herdr(*command))
        assert "error" not in response, f"Herdr failed: {command[:2]}"
        return response["result"]

    def text(pane):
        return herdr("pane", "read", pane, "--source", "recent-unwrapped", "--lines", "150")

    def await_text(pane, needle, timeout=60):
        # Do not forward terminal contents: preview panes contain bearer URLs.
        wait_for(lambda: needle in text(pane), needle, timeout)

    def close(pane):
        herdr("plugin", "pane", "close", pane)

    probe_env = None

    def probe(operation):
        completed = subprocess.run(["node", str(repo / "scripts/live-probe.mjs"), operation], env=probe_env, capture_output=True, text=True, timeout=180)
        if completed.returncode != 0:
            for diagnostic in re.findall(r"^PROBE_HTTP [a-z-]+=\d{3}$", completed.stdout, re.MULTILINE):
                print(diagnostic, flush=True)
            locations = re.findall(r"live-probe\.mjs:\d+:\d+", completed.stderr)
            raise AssertionError(f"Live probe failed: {operation}; {','.join(locations)}")
        print(completed.stdout.strip(), flush=True)

    server_log = open(base / "server.log", "w")
    server = subprocess.Popen([*cli, "server"], env=env, stdin=subprocess.DEVNULL, stdout=server_log, stderr=server_log)
    try:
        wait_for(lambda: (config / "sessions/smoke/herdr.sock").exists(), "Herdr server")
        print(run([binary, "--version"]).strip(), flush=True)
        if args.install_ref:
            assert len(args.install_ref) == 40 and all(c in "0123456789abcdef" for c in args.install_ref)
            herdr("plugin", "install", "blaxel-ai/herdr-blaxel-sandbox-plugin", "--ref", args.install_ref, "--yes")
        else:
            herdr("plugin", "link", str(repo))
        plugin = result("plugin", "list", "--json")["plugins"][0]
        assert plugin["enabled"] and plugin["plugin_id"] == "blaxel.sandbox"
        assert len(plugin["actions"]) == 11 and len(plugin["panes"]) == 7
        if args.install_ref:
            assert plugin["source"]["resolved_commit"] == args.install_ref
        installed = Path(plugin["plugin_root"])
        adapter = json.loads(run(["node", "--input-type=module", "-e", "import { getAdapter } from './src/adapters.mjs'; console.log(JSON.stringify(getAdapter(process.argv[1])))", args.agent], cwd=installed))
        run(["node", "-e", "import('@blaxel/core')"], cwd=installed)
        project = base / "invoice-summary"
        shutil.copytree(installed / "examples/invoice-summary", project)
        for command in [["git", "init", "-q"], ["git", "add", "."], ["git", "-c", "user.name=Herdr CI", "-c", "user.email=herdr@example.invalid", "commit", "-qm", "Invoice baseline"], ["npm", "test"]]:
            run(command, cwd=project)
        root = result("workspace", "create", "--cwd", str(project), "--label", "Herdr smoke", "--no-focus")["root_pane"]["pane_id"]
        plugin_config = Path(herdr("plugin", "config-dir", "blaxel.sandbox").strip())
        plugin_config.mkdir(parents=True, exist_ok=True)
        (plugin_config / "config.json").write_text(json.dumps({"agent": args.agent, "agentArgs": json.loads(args.agent_args), "workspace": os.environ.get("BL_WORKSPACE"), "sandboxNamePrefix": "herdr-smoke", "idleDelete": "30m", "previewPorts": [3000], "publicPreviews": False}))

        def open_pane(entrypoint, extra=None):
            command = ["plugin", "pane", "open", "--plugin", "blaxel.sandbox", "--entrypoint", entrypoint, "--placement", "split", "--target-pane", root, "--no-focus"]
            for key, value in (extra or {}).items():
                command.extend(["--env", f"{key}={value}"])
            return result(*command)["plugin_pane"]["pane"]["pane_id"]

        dashboard = open_pane("dashboard")
        await_text(dashboard, "No tracked Sandboxes")
        herdr("pane", "send-text", dashboard, "t")
        await_text(dashboard, "Choose a coding tool")
        await_text(dashboard, "Pi")
        herdr("pane", "send-text", dashboard, "\x1b")
        await_text(dashboard, "No tracked Sandboxes")
        original_config = (plugin_config / "config.json").read_text()
        herdr("pane", "send-text", dashboard, "t")
        await_text(dashboard, "Choose a coding tool")
        herdr("pane", "send-text", dashboard, "4\n")
        wait_for(lambda: json.loads((plugin_config / "config.json").read_text())["agent"] == "pi", "Pi selected and saved")
        assert json.loads((plugin_config / "config.json").read_text())["previewPorts"] == [3000]
        (plugin_config / "config.json").write_text(original_config)
        print("PASS plugin registration, dependencies, example tests and dashboard", flush=True)
        if args.live:
            # Exercise first-run Start directly from an empty dashboard.
            herdr("pane", "send-text", dashboard, "n")
            state_file = wait_for(lambda: next((base / "state").rglob("state.json"), None), "Start state")
            probe_env = dict(env, HERDR_PLUGIN_CONFIG_DIR=str(plugin_config), HERDR_PLUGIN_STATE_DIR=str(state_file.parent))

            def mapping():
                return next(iter(json.loads(state_file.read_text())["mappings"].values()), None)

            def connected():
                current = mapping()
                if current is None:
                    return None
                if current["lifecycleState"] == "failed":
                    message = str(current.get("lastError", "Start or terminal connection failed"))
                    for name, value in env.items():
                        if value and any(word in name for word in ["KEY", "TOKEN", "SECRET"]):
                            message = message.replace(value, "[REDACTED]")
                    message = re.sub(r"(?:sk-[A-Za-z0-9_-]+|Bearer [^\s\"]+)", "[REDACTED]", message)
                    raise AssertionError(message[:1200])
                return current if current["lifecycleState"] == "connected" else None

            current = wait_for(connected, "Start and terminal connection", 240)
            close(dashboard)
            agent_pane = current["remotePaneId"]
            await_text(agent_pane, "Ask anything" if args.agent == "opencode" else adapter["title"], 120)
            assert current["installedVersion"] == adapter["expectedVersion"]
            assert any(p["pane_id"] == agent_pane and p.get("agent") == adapter["herdrDetectionKind"] for p in result("agent", "list")["agents"])
            print(f"PASS Start, filtered upload, pinned {adapter['title']} {adapter['expectedVersion']} and Herdr detection", flush=True)
            probe("session")
            if args.model_test:
                prompt = f'Edit invoices.mjs using your file-editing tool. Add an exported function integrationProof() that returns the string "herdr-{args.agent}-verified". Preserve the existing code and do not change other files. Reply DONE after editing.'
                def ready_for_prompt():
                    screen = herdr("pane", "read", agent_pane, "--source", "visible")
                    if args.agent == "claude-code":
                        if "Do you want to use this API key" in screen:
                            herdr("pane", "send-keys", agent_pane, "Up")
                            time.sleep(0.3)
                            herdr("pane", "send-keys", agent_pane, "Enter")
                            time.sleep(0.5)
                            return False
                        if "Yes, I trust this folder" in screen or "Choose the text style" in screen or ("Security notes:" in screen and "Press Enter to continue" in screen):
                            herdr("pane", "send-keys", agent_pane, "Enter")
                            time.sleep(0.5)
                            return False
                        return "for shortcuts" in screen or "accept edits" in screen or "bypass permissions" in screen or "Try " in screen
                    if args.agent == "codex":
                        if "Use existing model" in screen:
                            herdr("pane", "send-keys", agent_pane, "Down")
                            time.sleep(0.3)
                            herdr("pane", "send-keys", agent_pane, "Enter")
                            time.sleep(0.5)
                            return False
                        return bool(re.search(r"gpt-[^\n]+ · /workspace", screen))
                    if args.agent == "pi":
                        return "(auto)" in screen or "gpt-5.4-mini" in screen
                    return "Ask anything" in screen or "Build" in screen
                wait_for(ready_for_prompt, f"{args.agent} ready for a prompt", 90)
                time.sleep(3)
                # A literal paste and a separate Enter exercise the remote terminal,
                # including tools whose initialization consumes early keystrokes.
                herdr("pane", "send-text", agent_pane, "\x1b[200~" + prompt + "\x1b[201~")
                time.sleep(0.5)
                herdr("pane", "send-keys", agent_pane, "Enter")
                probe("model")
            close(agent_pane)
            agent_pane = open_pane("agent", {"BLAXEL_HERDR_MAPPING_ID": current["id"], "HERDR_AGENT": adapter["herdrDetectionKind"]})
            wait_for(lambda: mapping().get("remotePaneId") == agent_pane and mapping().get("lifecycleState") == "connected", "reconnected pane", 60)
            probe("reconnected")
            probe("edit")
            probe("preview")
            preview_pane = open_pane("previews", {"BLAXEL_HERDR_MAPPING_ID": current["id"]})
            await_text(preview_pane, "bl_preview_token", 60)
            close(preview_pane)

            def operation(name):
                return open_pane("operation", {"BLAXEL_HERDR_MAPPING_ID": current["id"], "BLAXEL_HERDR_OPERATION": name})

            apply_pane = operation("apply-changes")
            await_text(apply_pane, "Apply locally?")
            assert "overdueCents" not in (project / "invoices.mjs").read_text()
            herdr("pane", "send-text", apply_pane, "n\n")
            await_text(apply_pane, "Canceled")
            assert "overdueCents" not in (project / "invoices.mjs").read_text()
            close(apply_pane)
            original = (project / "invoices.mjs").read_text()
            conflicting = original.replace("summarize(rows)", "summarize(rows = [])")
            (project / "invoices.mjs").write_text(conflicting)
            apply_pane = operation("apply-changes")
            await_text(apply_pane, "git apply --check failed")
            assert (project / "invoices.mjs").read_text() == conflicting
            close(apply_pane)
            (project / "invoices.mjs").write_text(original)
            apply_pane = operation("apply-changes")
            await_text(apply_pane, "Apply locally?")
            herdr("pane", "send-text", apply_pane, "y\n")
            await_text(apply_pane, "Changes applied locally")
            assert "overdueCents" in (project / "invoices.mjs").read_text()
            assert (project / "server.mjs").is_file()
            close(apply_pane)
            apply_pane = operation("apply-changes")
            await_text(apply_pane, "No remote changes")
            close(apply_pane)
            print("PASS reviewed apply: cancel and conflict preserve files, approval applies, repeat is unchanged", flush=True)
            stop_pane = operation("stop")
            await_text(stop_pane, "Agent stopped. Sandbox files are preserved.")
            probe("stopped")
            close(stop_pane)
            confirmation = open_pane("confirmation", {"BLAXEL_HERDR_MAPPING_ID": current["id"], "BLAXEL_HERDR_DESTRUCTIVE_ACTION": "delete"})
            await_text(confirmation, "Type DELETE")
            herdr("pane", "send-text", confirmation, "NO\n")
            wait_for(lambda: confirmation not in [p["pane_id"] for p in result("pane", "list")["panes"]], "canceled delete pane closed")
            probe("stopped")
            confirmation = open_pane("confirmation", {"BLAXEL_HERDR_MAPPING_ID": current["id"], "BLAXEL_HERDR_DESTRUCTIVE_ACTION": "delete"})
            await_text(confirmation, "Type DELETE")
            herdr("pane", "send-text", confirmation, "DELETE\n")
            wait_for(lambda: not json.loads(state_file.read_text())["mappings"], "typed deletion", 90)
            print("PASS typed deletion: incorrect text preserves sandbox; DELETE removes mapping", flush=True)
    finally:
        try:
            if probe_env:
                probe("cleanup")
        finally:
            subprocess.run([*cli, "session", "stop", "smoke"], env=env, capture_output=True, timeout=20)
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.terminate()
                server.wait(timeout=10)
            server_log.close()
