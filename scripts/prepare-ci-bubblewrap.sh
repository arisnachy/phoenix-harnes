#!/usr/bin/env bash
set -euo pipefail

# CI needs only bubblewrap's payload, not a system install. Pin the Noble
# security-update version, resolve it through APT's signed repository metadata,
# verify the downloaded archive against that metadata, then extract it into the
# ephemeral runner directory. This survives Ubuntu rotating superseded .deb
# files out of the pool without weakening integrity checks.
readonly BUBBLEWRAP_VERSION='0.9.0-1ubuntu0.3'

: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

archive="${RUNNER_TEMP}/bubblewrap_${BUBBLEWRAP_VERSION}_amd64.deb"
root="${RUNNER_TEMP}/dsh-bubblewrap"

sudo apt-get update -qq
expected_sha="$(
  apt-cache show "bubblewrap=${BUBBLEWRAP_VERSION}"     | awk '$1 == "SHA256:" { print $2; exit }'
)"
if [[ ! "${expected_sha}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "could not resolve SHA256 for bubblewrap ${BUBBLEWRAP_VERSION} from signed APT metadata" >&2
  exit 1
fi

rm -f "$archive"
(
  cd "$RUNNER_TEMP"
  apt-get download "bubblewrap=${BUBBLEWRAP_VERSION}" >/dev/null
)
if [[ ! -f "$archive" ]]; then
  echo "APT did not produce expected bubblewrap archive: $archive" >&2
  exit 1
fi
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum --check --status

rm -rf "$root"
mkdir -p "$root"
dpkg-deb --extract "$archive" "$root"
printf '%s\n' "$root/usr/bin" >> "$GITHUB_PATH"

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 \
  || echo 'apparmor userns knob absent — the functional probe decides'
"$root/usr/bin/bwrap" --version
"$root/usr/bin/bwrap" --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
echo 'bubblewrap functional probe passed'
