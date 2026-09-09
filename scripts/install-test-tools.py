#!/usr/bin/env python3
"""Download checksum-verified official test binaries without changing user installations."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import tarfile
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--herdr", required=True, help="minimum pinned version or latest")
parser.add_argument("--blaxel", action="store_true")
parser.add_argument("--directory", required=True)
args = parser.parse_args()
directory = Path(args.directory).resolve()
directory.mkdir(parents=True, exist_ok=True)
system = platform.system()
machine = platform.machine().lower()
assert system in ["Darwin", "Linux"]
assert machine in ["arm64", "aarch64", "x86_64", "amd64"]
arm = machine in ["arm64", "aarch64"]


def release(repo, version):
    suffix = "latest" if version == "latest" else f"tags/v{version}"
    request = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/{suffix}", headers={"Accept": "application/vnd.github+json"})
    if os.environ.get("GH_TOKEN"):
        request.add_header("Authorization", f"Bearer {os.environ['GH_TOKEN']}")
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def download(release_info, name):
    asset = next(asset for asset in release_info["assets"] if asset["name"] == name)
    digest = asset.get("digest", "")
    assert digest.startswith("sha256:"), "Release asset lacks a SHA256 digest"
    with urllib.request.urlopen(asset["browser_download_url"], timeout=120) as response:
        data = response.read()
    assert hashlib.sha256(data).hexdigest() == digest.removeprefix("sha256:"), "Checksum mismatch"
    return data


host = release("herdrdev/herdr", args.herdr)
asset_name = f"herdr-{'macos' if system == 'Darwin' else 'linux'}-{'aarch64' if arm else 'x86_64'}"
(directory / "herdr").write_bytes(download(host, asset_name))
(directory / "herdr").chmod(0o755)
print(f"Verified Herdr {host['tag_name']}")
if args.blaxel:
    toolkit = release("blaxel-ai/toolkit", "0.1.110")
    archive = directory / "blaxel.tar.gz"
    archive.write_bytes(download(toolkit, f"blaxel_{system}_{'arm64' if arm else 'x86_64'}.tar.gz"))
    with tarfile.open(archive) as package:
        binary = package.getmember("blaxel")
        assert binary.isfile()
        (directory / "bl").write_bytes(package.extractfile(binary).read())
    (directory / "bl").chmod(0o755)
    archive.unlink()
    print(f"Verified Blaxel CLI {toolkit['tag_name']}")
if os.environ.get("GITHUB_PATH"):
    with open(os.environ["GITHUB_PATH"], "a") as output:
        output.write(f"{directory}\n")
