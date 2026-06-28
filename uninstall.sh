#!/usr/bin/env bash
set -euo pipefail

APP_BUNDLE="$HOME/Applications/Code Video BG.app"
USER_DATA="$HOME/Library/Application Support/Code Video BG"
LABEL="com.naoto.code-youtube-bg.server"
PURGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)
      PURGE=1
      shift
      ;;
    -h|--help)
      cat <<'USAGE'
Usage:
  ./uninstall.sh [--purge]

Options:
  --purge  Also remove Code Video BG application support data
USAGE
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

osascript -e 'tell application id "com.naoto.CodeVideoBG" to quit' >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)" "$USER_DATA/code-youtube-bg-server.plist" >/dev/null 2>&1 || true
launchctl remove "$LABEL" >/dev/null 2>&1 || true
pkill -TERM -f "code-youtube-bg-server" >/dev/null 2>&1 || true
pkill -TERM -f "mpv .*--title=code-youtube-bg-audio" >/dev/null 2>&1 || true

rm -f "$HOME/.local/bin/code-youtube-bg"
rm -rf "$HOME/.local/lib/code-youtube-bg"
rm -rf "$APP_BUNDLE"

if [[ "$PURGE" == "1" ]]; then
  rm -rf "$USER_DATA"
fi

echo "Uninstalled code-youtube-bg."
