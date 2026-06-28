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

find_code_cli() {
  local source_app="$1"
  local candidates=(
    "$(command -v code || true)"
    "$source_app/Contents/Resources/app/bin/code"
    "$APP_BUNDLE/Contents/Resources/app/bin/code"
  )

  local path
  for path in "${candidates[@]}"; do
    if [[ -n "$path" && -x "$path" ]]; then
      printf '%s\n' "$path"
      return 0
    fi
  done

  return 1
}

install_deps() {
  local missing_pkgs=()

  command -v node >/dev/null 2>&1 || missing_pkgs+=(node)
  command -v yt-dlp >/dev/null 2>&1 || missing_pkgs+=(yt-dlp)
  command -v mpv >/dev/null 2>&1 || missing_pkgs+=(mpv)
  command -v ffmpeg >/dev/null 2>&1 || missing_pkgs+=(ffmpeg)

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
  rm -rf "$APP_BUNDLE"
fi

mkdir -p "$HOME/Applications" "$HOME/.local/bin" "$HOME/.local/lib/code-youtube-bg"
ditto "$source_app" "$APP_BUNDLE"

plist="$APP_BUNDLE/Contents/Info.plist"
plist_set "$plist" CFBundleIdentifier "$BUNDLE_ID"
plist_set "$plist" CFBundleName "$APP_NAME"
plist_set "$plist" CFBundleDisplayName "$APP_NAME"

xattr -dr com.apple.quarantine "$APP_BUNDLE" >/dev/null 2>&1 || true
codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null

install -m 0755 "$REPO_ROOT/bin/code-youtube-bg" "$HOME/.local/bin/code-youtube-bg"
install -m 0755 "$REPO_ROOT/lib/server.js" "$HOME/.local/lib/code-youtube-bg/server.js"

code_cli="$(find_code_cli "$source_app" || true)"
if [[ -z "$code_cli" ]]; then
  echo "Could not find the VS Code command line helper to install caoge.vscode-background." >&2
  echo "Open VS Code, install the extension 'caoge.vscode-background', then run code-youtube-bg." >&2
else
  "$code_cli" --install-extension caoge.vscode-background --force >/dev/null
fi

ensure_path

cat <<EOF
Installed code-youtube-bg.

Restart your terminal, or run:
  export PATH="\$HOME/.local/bin:\$PATH"

Try:
  CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --stream --audio --volume 0.50 'https://www.youtube.com/watch?v=VIDEO_ID'

The dedicated app is:
  $APP_BUNDLE
EOF
