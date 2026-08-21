#!/bin/bash
#
# Build the installer zip that non-technical users download.
#
# A zip rather than three loose files, for two reasons that both bite in practice:
# a browser downloading a .command strips its executable bit and it opens in TextEdit
# instead of running, and a raw link to a filename with spaces in it is easy to mangle.
# Zip preserves the mode and hands over one obvious thing to double-click.
#
# Usage:  ./setup/build-release.sh          (from the repo root or anywhere)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
OUT_DIR="$ROOT/release"
STAGE="$OUT_DIR/watsmytask-installer"
# A STABLE filename, deliberately without the version in it. The download button on the
# homepage points at
#   .../releases/latest/download/watsmytask-installer.zip
# which GitHub only resolves when the asset name never changes. The version lives inside
# the zip instead, stamped into the readme, and on the release that carries it.
ZIP="$OUT_DIR/watsmytask-installer.zip"

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE"

# Stamp the version in, so a downloaded zip can still say what it is.
sed "s/__VERSION__/$VERSION/g" "$HERE/READ ME FIRST.txt" > "$STAGE/READ ME FIRST.txt"
# Pin both installers to this exact version. The zip is labelled with a version, so it
# had better install that one — and a pinned install fails loudly if the matching npm
# publish never happened, where `latest` would quietly fetch the previous release and
# look like it worked. The pattern has no line anchors so it works on the .bat's CRLF
# line endings as well as the .command's LF.
sed "s/VERSION_SPEC=latest/VERSION_SPEC=$VERSION/" \
  "$HERE/macOS - Install watsmytask.command" > "$STAGE/macOS - Install watsmytask.command"
sed "s/VERSION_SPEC=latest/VERSION_SPEC=$VERSION/" \
  "$HERE/Windows - Install watsmytask.bat" > "$STAGE/Windows - Install watsmytask.bat"

# Never ship a zip that still says "latest" — that is the bug this exists to prevent.
for f in "$STAGE/macOS - Install watsmytask.command" "$STAGE/Windows - Install watsmytask.bat"; do
  if grep -q "VERSION_SPEC=latest" "$f"; then
    echo "  PROBLEM: $(basename "$f") was not pinned to $VERSION" >&2
    exit 1
  fi
  grep -q "VERSION_SPEC=$VERSION" "$f" || {
    echo "  PROBLEM: $(basename "$f") has no VERSION_SPEC to pin" >&2
    exit 1
  }
done

# The whole point of shipping a zip: this bit has to survive the trip.
chmod +x "$STAGE/macOS - Install watsmytask.command"

# -X drops the resource forks and .DS_Store noise that make a zip look untrustworthy
# when a Windows user opens it.
( cd "$OUT_DIR" && zip -q -r -X "$(basename "$ZIP")" "$(basename "$STAGE")" )
rm -rf "$STAGE"

echo "  built  $ZIP  (watsmytask $VERSION)"
echo
unzip -l "$ZIP" | sed 's/^/  /'

# Prove the executable bit made it, rather than trusting that it did.
MODE="$(unzip -Z "$ZIP" | grep 'Install watsmytask.command' | awk '{print $1}')"
case "$MODE" in
  -rwx*) echo "  exec bit preserved: $MODE" ;;
  *)     echo "  PROBLEM: the macOS installer is not executable in the zip ($MODE)"; exit 1 ;;
esac
