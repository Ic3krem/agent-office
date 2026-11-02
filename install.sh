#!/usr/bin/env bash
# Agent Office installer for macOS and Linux. Use the script from the release tag you want to install (the tag is pinned in the URL):
#   curl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/v1.2.6/install.sh | bash
# What it does, and what it refuses to do:
#   1. downloads latest.json + latest.json.sig from THAT release tag over https (no "latest" lookup, no API),
#   2. verifies the Ed25519 signature of the manifest against the release public key pinned below (OpenSSL 3 or Node.js),
#   3. downloads the build named in the manifest (must be on this repository's release page) and checks its SHA-256,
#   4. installs it for the current user.
# Any failed check aborts before anything is installed.
# Verify a downloaded release folder without installing:  AGENT_OFFICE_VERIFY_ONLY=/path/to/folder bash install.sh
set -euo pipefail
REPO="Ic3krem/agent-office"
DEFAULT_TAG="v1.2.5"   # bumped for every release so this script and the release it installs always match
TAG="${AGENT_OFFICE_TAG:-$DEFAULT_TAG}"
# Ed25519 release key (SPKI PEM); same key as desktop/update-key.mjs
PUBKEY_PEM='-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAUOhtrcwZBBls13mV3jdJsk4V8xBZOB3cQNypRjN0Vcc=
-----END PUBLIC KEY-----'
fail() { echo "error: $*" >&2; exit 1; }
case "$TAG" in v[0-9]*.[0-9]*.[0-9]*) ;; *) fail "Invalid release tag '$TAG'." ;; esac
echo "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || fail "Invalid release tag '$TAG'."

sha_tool() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# verify_manifest DIR: Ed25519 over the exact bytes of latest.json.
verify_manifest() {
  local dir="$1" w; w="$(mktemp -d)"; local pem="$w/pub.pem"
  printf '%s\n' "$PUBKEY_PEM" > "$pem"
  if openssl version 2>/dev/null | grep -q '^OpenSSL 3'; then
    openssl base64 -d -A -in "$dir/latest.json.sig" -out "$w/sig.bin" 2>/dev/null || fail "The signature file is not valid base64; not installing."
    if openssl pkeyutl -verify -pubin -inkey "$pem" -rawin -in "$dir/latest.json" -sigfile "$w/sig.bin" >/dev/null 2>&1; then rm -rf "$w"; return 0; fi
    fail "The release manifest signature is INVALID for the pinned Agent Office release key. Not installing."
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs = require("fs"), c = require("crypto"), d = process.argv[1];
      const ok = c.verify(null, fs.readFileSync(d + "/latest.json"), fs.readFileSync(process.argv[2]), Buffer.from(fs.readFileSync(d + "/latest.json.sig", "utf8").trim(), "base64"));
      process.exit(ok ? 0 : 1);' "$dir" "$pem" 2>/dev/null && { rm -rf "$w"; return 0; }
    fail "The release manifest signature is INVALID for the pinned Agent Office release key. Not installing."
  fi
  fail "Cannot verify the signature: this needs OpenSSL 3 or Node.js (macOS ships LibreSSL; install Node.js or 'brew install openssl@3' and put it first on PATH)."
}

if [ -n "${AGENT_OFFICE_VERIFY_ONLY:-}" ]; then
  verify_manifest "$AGENT_OFFICE_VERIFY_ONLY"
  echo "Signature verifies against the pinned release key."
  exit 0
fi

command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ] || {
  echo "Agent Office runs your agents with Claude Code, which is not installed yet."
  echo "Install it first from https://claude.ai/install.sh (read it before running it), then run  claude  once to log in."
}

BASE="https://github.com/$REPO/releases/download/$TAG/"
TMP="$(mktemp -d)"; chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
echo "Fetching the signed manifest for $TAG..."
for f in latest.json latest.json.sig; do
  curl -fsSL --proto '=https' --tlsv1.2 "$BASE$f" -o "$TMP/$f" || fail "Release $TAG has no $f. Releases from before signed manifests cannot be installed by this script; download the build from the release page instead."
done
verify_manifest "$TMP"
echo "Manifest signature verified."

# asset_field PLATFORM ARCH FIELD: reads the (pretty-printed, one key per line) manifest; an asset without "arch" applies to every arch.
asset_field() {
  awk -v plat="$1" -v arch="$2" -v field="$3" '
    /^[[:space:]]*\{[[:space:]]*$/ { inobj = 1; p = ""; a = ""; u = ""; s = ""; next }
    inobj && /"platform"/ { p = $0; sub(/^[^:]*:[[:space:]]*"/, "", p); sub(/".*$/, "", p) }
    inobj && /"arch"/     { a = $0; sub(/^[^:]*:[[:space:]]*"/, "", a); sub(/".*$/, "", a) }
    inobj && /"url"/      { u = $0; sub(/^[^:]*:[[:space:]]*"/, "", u); sub(/".*$/, "", u) }
    inobj && /"sha256"/   { s = $0; sub(/^[^:]*:[[:space:]]*"/, "", s); sub(/".*$/, "", s) }
    inobj && /^[[:space:]]*\},?[[:space:]]*$/ { inobj = 0; if (p == plat && (a == "" || a == arch)) { print (field == "url" ? u : s); exit } }
  ' "$TMP/latest.json"
}
manifest_version="$(grep -m1 '"version"' "$TMP/latest.json" | sed -E 's/.*"version"[^"]*"([^"]*)".*/\1/')"
[ "v$manifest_version" = "$TAG" ] || fail "Manifest is for version $manifest_version, not $TAG. Not installing."

# fetch_verified PLATFORM ARCH DEST
fetch_verified() {
  local url want got
  url="$(asset_field "$1" "$2" url)"; want="$(asset_field "$1" "$2" sha256)"
  [ -n "$url" ] || fail "No $1 build for $2 in release $TAG."
  case "$url" in "$BASE"*) ;; *) fail "Download is not hosted on this release page; refusing." ;; esac
  echo "$want" | grep -Eq '^[0-9a-fA-F]{64}$' || fail "Manifest has no valid SHA-256 for the download."
  echo "Downloading $(basename "$url")..."
  curl -fL --proto '=https' --tlsv1.2 --progress-bar "$url" -o "$3"
  got="$(sha_tool "$3")"
  [ "$got" = "$(echo "$want" | tr 'A-F' 'a-f')" ] || { rm -f "$3"; fail "SHA-256 mismatch: expected $want, got $got. Download discarded."; }
  echo "SHA-256 verified ($got)."
}
DESKTOP="${XDG_DESKTOP_DIR:-$HOME/Desktop}"; mkdir -p "$DESKTOP"

case "$(uname -s)" in
  Darwin)
    ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
    fetch_verified darwin "$ARCH" "$TMP/app.dmg"
    MNT="$(hdiutil attach -nobrowse -quiet "$TMP/app.dmg" | tail -n1 | awk -F'\t' '{print $NF}')"
    rm -rf "/Applications/Agent Office.app"; cp -R "$MNT/Agent Office.app" /Applications/
    hdiutil detach -quiet "$MNT"
    # The app isn't signed by Apple; allow it to open without the Gatekeeper prompt.
    xattr -dr com.apple.quarantine "/Applications/Agent Office.app" 2>/dev/null || true
    ln -sfn "/Applications/Agent Office.app" "$DESKTOP/Agent Office"
    open "/Applications/Agent Office.app"
    ;;
  Linux)
    BIN="$HOME/.local/bin"; APPS="$HOME/.local/share/applications"; ICONS="$HOME/.local/share/icons"
    mkdir -p "$BIN" "$APPS" "$ICONS"
    fetch_verified linux x64 "$BIN/agent-office.AppImage"
    chmod +x "$BIN/agent-office.AppImage"
    curl -fsSL --proto '=https' --tlsv1.2 "https://raw.githubusercontent.com/$REPO/$TAG/desktop/icon.png" -o "$ICONS/agent-office.png" || true
    cat > "$APPS/agent-office.desktop" <<EOF
[Desktop Entry]
Name=Agent Office
Comment=Pixel office for your Claude Code agents
Exec=$BIN/agent-office.AppImage %U
Icon=$ICONS/agent-office.png
Terminal=false
Type=Application
Categories=Development;
EOF
    cp "$APPS/agent-office.desktop" "$DESKTOP/agent-office.desktop"; chmod +x "$DESKTOP/agent-office.desktop"
    command -v gio >/dev/null 2>&1 && gio set "$DESKTOP/agent-office.desktop" metadata::trusted true 2>/dev/null || true
    nohup "$BIN/agent-office.AppImage" >/dev/null 2>&1 &
    ;;
  *) echo "Unsupported system: $(uname -s). On Windows use install.ps1."; exit 1 ;;
esac
echo "Done. Agent Office $TAG is running, and there is a shortcut on your desktop."
