#!/usr/bin/env bash
# Installs (or upgrades) the eufy-sdk Home Assistant integration into the running
# homeassistant container's /config/custom_components — the same files HACS would
# install, pinned to a release so upgrades are deliberate. Restart HA afterwards.
#
# Usage (on the NUC, or anywhere `docker` reaches it):
#   scripts/ha-install-eufy-sdk.sh            # default version below
#   scripts/ha-install-eufy-sdk.sh 0.6.1      # specific release
#   docker restart homeplatform-homeassistant
#
# Keep the bridge image tag in docker-compose.yml on the same minor version.
set -euo pipefail

VERSION="${1:-0.6.0}"
CONTAINER="${HA_CONTAINER:-homeplatform-homeassistant}"

# The download/extract runs inside the HA container (it has Python), so this
# works the same from Git Bash on Windows as from Linux.
docker exec -i -e EUFY_SDK_VERSION="$VERSION" "$CONTAINER" python3 - <<'PY'
import io, os, shutil, tarfile, urllib.request

version = os.environ["EUFY_SDK_VERSION"]
url = f"https://github.com/mega-yfue/ha-eufy-sdk/archive/refs/tags/{version}.tar.gz"
prefix = f"ha-eufy-sdk-{version}/custom_components/eufy_sdk/"
dest = "/config/custom_components/eufy_sdk"

data = urllib.request.urlopen(url, timeout=60).read()
tmp = dest + ".new"
shutil.rmtree(tmp, ignore_errors=True)
with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
    members = [m for m in tar.getmembers() if m.name.startswith(prefix) and m.name != prefix]
    if not members:
        raise SystemExit(f"eufy_sdk not found in release {version}")
    for m in members:
        m.name = m.name[len(prefix):]
        tar.extract(m, tmp, filter="data")
# Swap in atomically-ish so a failed download never leaves a half-installed copy.
shutil.rmtree(dest, ignore_errors=True)
os.makedirs(os.path.dirname(dest), exist_ok=True)
os.rename(tmp, dest)
print(f"installed eufy_sdk {version} -> {dest} ({len(members)} files)")
PY
