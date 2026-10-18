#!/usr/bin/env bash
# Agent Office installer for macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/Ic3krem/agent-office/main/install.sh | bash
# Downloads the latest release, installs it and adds a desktop shortcut.
set -euo pipefail
REPO="Ic3krem/agent-office"
API="https://api.github.com/repos/$REPO/releases/latest"

command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ] || {
  echo "Agent Office runs your agents with Claude Code, which is not installed yet."
  echo "Install it first:  curl -fsSL https://claude.ai/install.sh | bash   then run  claude  once to log in."
}

echo "Finding the latest Agent Office release..."
JSON="$(curl -fsSL -H 'User-Agent: agent-office-installer' "$API")"
asset_url() { printf '%s' "$JSON" | grep -o '"browser_download_url": *"[^"]*"' | cut -d'"' -f4 | grep -E "$1" | head -n1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
DESKTOP="${XDG_DESKTOP_DIR:-$HOME/Desktop}"; mkdir -p "$DESKTOP"

case "$(uname -s)" in
  Darwin)
    ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
    URL="$(asset_url "-$ARCH\.dmg$")"; [ -n "$URL" ] || { echo "No macOS build for $ARCH in the latest release."; exit 1; }
    echo "Downloading $(basename "$URL")..."; curl -fL --progress-bar "$URL" -o "$TMP/app.dmg"
    MNT="$(hdiutil attach -nobrowse -quiet "$TMP/app.dmg" | tail -n1 | awk -F'\t' '{print $NF}')"
    rm -rf "/Applications/Agent Office.app"; cp -R "$MNT/Agent Office.app" /Applications/
    hdiutil detach -quiet "$MNT"
    # The app isn't signed by Apple; allow it to open without the Gatekeeper prompt.
    xattr -dr com.apple.quarantine "/Applications/Agent Office.app" 2>/dev/null || true
    ln -sfn "/Applications/Agent Office.app" "$DESKTOP/Agent Office"
    open "/Applications/Agent Office.app"
    ;;
  Linux)
    URL="$(asset_url '\.AppImage$')"; [ -n "$URL" ] || { echo "No Linux build in the latest release."; exit 1; }
    BIN="$HOME/.local/bin"; APPS="$HOME/.local/share/applications"; ICONS="$HOME/.local/share/icons"
    mkdir -p "$BIN" "$APPS" "$ICONS"
    echo "Downloading $(basename "$URL")..."; curl -fL --progress-bar "$URL" -o "$BIN/agent-office.AppImage"
    chmod +x "$BIN/agent-office.AppImage"
    curl -fsSL "https://raw.githubusercontent.com/$REPO/main/desktop/icon.png" -o "$ICONS/agent-office.png" || true
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
echo "Done. Agent Office is running, and there is a shortcut on your desktop."
