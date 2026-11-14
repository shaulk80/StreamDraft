#!/usr/bin/env bash
# Signs the Firefox build on AMO as an unlisted add-on (decision 0011) and swaps
# the signed .xpi in for the unsigned zip.
#
#   bash scripts/sign-firefox.sh <assets-dir> <signed-dir>
#
# <assets-dir> holds the CI packages: streamdraft-<version>-firefox.zip,
# -sources.zip and SHA256SUMS.txt. The signed file is written to <signed-dir>
# (kept apart so a workflow can keep it even when a later step fails: AMO signs
# a version number only once). Credentials come from WEB_EXT_API_KEY and
# WEB_EXT_API_SECRET, which web-ext reads itself, so they never appear on a
# command line. Without them nothing is changed and the script exits 0 with a
# warning; any other problem exits 1.

set -euo pipefail

assets="${1:-}"
signed="${2:-}"
if [ -z "$assets" ] || [ -z "$signed" ]; then
  echo "usage: sign-firefox.sh <assets-dir> <signed-dir>" >&2
  exit 1
fi

if [ -z "${WEB_EXT_API_KEY:-}" ] || [ -z "${WEB_EXT_API_SECRET:-}" ]; then
  echo "::warning title=Firefox build not signed::AMO_JWT_ISSUER or AMO_JWT_SECRET is not set, so the release carries the unsigned Firefox zip."
  exit 0
fi

# Exactly one file must match each pattern, or we would sign the wrong thing.
single_file() {
  local pattern="$1"
  local matches=()
  local file
  for file in "$assets"/$pattern; do
    if [ -f "$file" ]; then
      matches+=("$file")
    fi
  done
  if [ "${#matches[@]}" -ne 1 ]; then
    echo "expected one file matching $assets/$pattern, found ${#matches[@]}" >&2
    return 1
  fi
  printf '%s\n' "${matches[0]}"
}

firefox_zip="$(single_file 'streamdraft-*-firefox.zip')"
sources_zip="$(single_file 'streamdraft-*-sources.zip')"
version="$(basename "$firefox_zip" -firefox.zip)"
version="${version#streamdraft-}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/extension" "$signed"
unzip -q "$firefox_zip" -d "$work/extension"

echo "Signing StreamDraft $version on AMO (unlisted)..."
pnpm exec web-ext sign \
  --source-dir "$work/extension" \
  --artifacts-dir "$work/artifacts" \
  --channel unlisted \
  --upload-source-code "$sources_zip" \
  --approval-timeout 900000

signed_files=("$work"/artifacts/*.xpi)
if [ "${#signed_files[@]}" -ne 1 ] || [ ! -f "${signed_files[0]}" ]; then
  echo "web-ext sign did not produce exactly one .xpi" >&2
  exit 1
fi

xpi="$signed/streamdraft-$version-firefox.xpi"
cp "${signed_files[0]}" "$xpi"

# A signed package carries Mozilla's signature in META-INF.
if ! unzip -l "$xpi" | grep -q 'META-INF/'; then
  echo "$xpi has no META-INF signature files" >&2
  exit 1
fi

# The signed file replaces the unsigned zip; the sums are written again (same
# format as scripts/build.ps1: "<hash> *<name>", names in ordinal order).
rm -f "$firefox_zip"
cp "$xpi" "$assets/"
(
  cd "$assets"
  export LC_ALL=C
  rm -f SHA256SUMS.txt
  for name in $(ls -1 | sort); do
    sha256sum -b "$name"
  done > "$work/SHA256SUMS.txt"
  mv "$work/SHA256SUMS.txt" SHA256SUMS.txt
  sha256sum -c SHA256SUMS.txt
)
echo "Signed $xpi"
