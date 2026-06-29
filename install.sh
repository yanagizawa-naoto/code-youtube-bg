#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Code Video BG"
APP_BUNDLE="$HOME/Applications/${APP_NAME}.app"
BUNDLE_ID="com.naoto.CodeVideoBG"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE=0
SKIP_BREW=0

usage() {
  cat <<'USAGE'
Usage:
  ./install.sh [--force] [--skip-brew]

Options:
  --force      Replace an existing ~/Applications/Code Video BG.app
  --skip-brew  Do not install missing Homebrew packages automatically

Environment:
  CODE_APP_PATH=/Applications/Visual Studio Code.app
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    --skip-brew)
      SKIP_BREW=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is macOS-only." >&2
  exit 1
fi

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required repository file: $1" >&2
    exit 1
  fi
}

find_code_app() {
  local candidates=()
  if [[ -n "${CODE_APP_PATH:-}" ]]; then
    candidates+=("$CODE_APP_PATH")
  fi
  candidates+=(
    "$HOME/Applications/Visual Studio Code.app"
    "/Applications/Visual Studio Code.app"
    "$HOME/Applications/Code.app"
    "/Applications/Code.app"
  )

  local path
  for path in "${candidates[@]}"; do
    if [[ -d "$path" && -x "$path/Contents/MacOS/Code" ]]; then
      printf '%s\n' "$path"
      return 0
    fi
  done

  return 1
}

install_deps() {
  local missing_pkgs=()

  command -v node >/dev/null 2>&1 || missing_pkgs+=(node)

  if [[ ${#missing_pkgs[@]} -eq 0 ]]; then
    return 0
  fi

  if [[ "$SKIP_BREW" == "1" ]]; then
    echo "Missing dependencies: ${missing_pkgs[*]}" >&2
    echo "Install them with Homebrew, then re-run ./install.sh." >&2
    exit 1
  fi

  if ! command -v brew >/dev/null 2>&1; then
    echo "Missing dependencies: ${missing_pkgs[*]}" >&2
    echo "Homebrew was not found. Install Homebrew or re-run with --skip-brew after installing dependencies manually." >&2
    exit 1
  fi

  brew install "${missing_pkgs[@]}"
}

plist_set() {
  local plist="$1"
  local key="$2"
  local value="$3"
  /usr/libexec/PlistBuddy -c "Set :$key $value" "$plist" >/dev/null 2>&1 ||
    /usr/libexec/PlistBuddy -c "Add :$key string $value" "$plist" >/dev/null
}

stop_existing_app() {
  osascript -e 'tell application id "com.naoto.CodeVideoBG" to quit' >/dev/null 2>&1 || true
  pkill -TERM -f "$APP_BUNDLE/Contents/MacOS/Code" >/dev/null 2>&1 || true

  for _ in {1..30}; do
    if ! pgrep -f "$APP_BUNDLE/Contents/MacOS/Code" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  pkill -KILL -f "$APP_BUNDLE/Contents/MacOS/Code" >/dev/null 2>&1 || true
}

ensure_path() {
  local zshrc="$HOME/.zshrc"
  local line='export PATH="$HOME/.local/bin:$PATH"'

  mkdir -p "$HOME/.local/bin"
  touch "$zshrc"

  if ! grep -Fq "$line" "$zshrc"; then
    {
      printf '\n# code-youtube-bg\n'
      printf '%s\n' "$line"
    } >> "$zshrc"
  fi
}

require_file "$REPO_ROOT/bin/code-youtube-bg"
require_file "$REPO_ROOT/lib/server.js"

install_deps

source_app="$(find_code_app || true)"
if [[ -z "$source_app" ]]; then
  echo "Could not find Visual Studio Code.app." >&2
  echo "Install VS Code first, or set CODE_APP_PATH=/path/to/Visual Studio Code.app." >&2
  exit 1
fi

if [[ -d "$APP_BUNDLE" ]]; then
  if [[ "$FORCE" != "1" ]]; then
    echo "$APP_BUNDLE already exists. Re-run with --force to replace it." >&2
    exit 1
  fi
  stop_existing_app
  rm -rf "$APP_BUNDLE"
fi

mkdir -p "$HOME/Applications" "$HOME/.local/bin" "$HOME/.local/lib/code-youtube-bg"
ditto "$source_app" "$APP_BUNDLE"

plist="$APP_BUNDLE/Contents/Info.plist"
plist_set "$plist" CFBundleIdentifier "$BUNDLE_ID"
plist_set "$plist" CFBundleDisplayName "$APP_NAME"

xattr -dr com.apple.quarantine "$APP_BUNDLE" >/dev/null 2>&1 || true
codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null

install -m 0755 "$REPO_ROOT/bin/code-youtube-bg" "$HOME/.local/bin/code-youtube-bg"
install -m 0755 "$REPO_ROOT/lib/server.js" "$HOME/.local/lib/code-youtube-bg/server.js"

ensure_path

cat <<EOF
Installed code-youtube-bg.

Restart your terminal, or run:
  export PATH="\$HOME/.local/bin:\$PATH"

Try:
  CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --audio --volume 0.50 'https://www.youtube.com/watch?v=VIDEO_ID'

The dedicated app is:
  $APP_BUNDLE
EOF
