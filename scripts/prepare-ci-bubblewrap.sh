#!/usr/bin/env bash
set -euo pipefail

# CI needs only bubblewrap's payload, not a system install. Pin each
# supported Ubuntu release to its security-update version, resolve through
# signed APT metadata, verify the archive SHA256, then extract into the runner.
# Fail closed for unrecognized images instead of selecting an unreviewed package.
if [[ ! -r /etc/os-release ]]; then
  echo 'cannot identify Ubuntu runner release for pinned bubblewrap' >&2
  exit 1
fi
. /etc/os-release
case "${ID:-}:${VERSION_ID:-}" in
  ubuntu:24.04) readonly BUBBLEWRAP_VERSION='0.9.0-1ubuntu0.3' ;;
  ubuntu:26.04) readonly BUBBLEWRAP_VERSION='0.11.1-1ubuntu0.3' ;;
  *) echo "unsupported runner release for pinned bubblewrap: ${ID:-unknown} ${VERSION_ID:-unknown}" >&2; exit 1 ;;
esac

: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

root="${RUNNER_TEMP}/dsh-bubblewrap"

sudo apt-get update -qq
expected_sha="$(
  apt-cache show "bubblewrap=${BUBBLEWRAP_VERSION}" \
    | awk '$1 == "SHA256:" { sha = $2 } END { if (sha != "") print sha }'
)"
if [[ ! "${expected_sha}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "could not resolve SHA256 for bubblewrap ${BUBBLEWRAP_VERSION} from signed APT metadata" >&2
  exit 1
fi

# APT may choose a filename differing from the package-version spelling.
# Admit exactly one new archive, and authenticate it by the signed APT digest.
rm -f "${RUNNER_TEMP}"/bubblewrap_*.deb
(
  cd "$RUNNER_TEMP"
  apt-get download "bubblewrap=${BUBBLEWRAP_VERSION}"
)
shopt -s nullglob
archives=("${RUNNER_TEMP}"/bubblewrap_*.deb)
shopt -u nullglob
if (( ${#archives[@]} != 1 )); then
  echo "APT produced ${#archives[@]} candidate bubblewrap archives; expected exactly one" >&2
  ls -la "${RUNNER_TEMP}"/bubblewrap* >&2 || true
  exit 1
fi
archive="${archives[0]}"
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
