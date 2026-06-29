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
  CODE_YOUTUBE_BG_SKIP_FFMPEG_PATCH=1  # Do not patch the dedicated app's ffmpeg
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

app_electron_version() {
  local package_json="$1"
  node - "$package_json" <<'NODE'
const fs = require('fs');
const packageJson = process.argv[2];
try {
  const packageInfo = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
  const version = packageInfo.devDependencies && packageInfo.devDependencies.electron || '';
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    process.stdout.write(version);
    process.exit(0);
  }
} catch (_) {}
process.stdout.write('42.2.0');
NODE
}

patch_ffmpeg_for_youtube() {
  if [[ "${CODE_YOUTUBE_BG_SKIP_FFMPEG_PATCH:-0}" == "1" ]]; then
    return 0
  fi

  local arch
  case "$(uname -m)" in
    arm64)
      arch="arm64"
      ;;
    x86_64)
      arch="x64"
      ;;
    *)
      echo "Unsupported macOS architecture for Electron ffmpeg patch: $(uname -m)" >&2
      exit 1
      ;;
  esac

  local electron_version
  electron_version="$(app_electron_version "$APP_BUNDLE/Contents/Resources/app/package.json")"

  local cache_dir="$HOME/.cache/code-youtube-bg/electron-v${electron_version}-darwin-${arch}"
  local zip_path="$cache_dir/electron.zip"
  local ffmpeg_src="$cache_dir/Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib"
  local ffmpeg_dst="$APP_BUNDLE/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib"
  local ffmpeg_backup="$ffmpeg_dst.before-code-youtube-bg"

  if [[ ! -f "$ffmpeg_dst" ]]; then
    echo "Could not find dedicated app ffmpeg library: $ffmpeg_dst" >&2
    exit 1
  fi

  if [[ ! -f "$ffmpeg_src" ]]; then
    mkdir -p "$cache_dir"
    curl -L --fail --progress-bar \
      -o "$zip_path" \
      "https://github.com/electron/electron/releases/download/v${electron_version}/electron-v${electron_version}-darwin-${arch}.zip"
    unzip -q -o "$zip_path" \
      "Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib" \
      -d "$cache_dir"
  fi

  if [[ ! -f "$ffmpeg_src" ]]; then
    echo "Failed to extract Electron ffmpeg library for ${electron_version} darwin-${arch}" >&2
    exit 1
  fi

  if [[ ! -f "$ffmpeg_backup" ]]; then
    cp -p "$ffmpeg_dst" "$ffmpeg_backup"
  fi

  if ! cmp -s "$ffmpeg_src" "$ffmpeg_dst"; then
    cp -p "$ffmpeg_src" "$ffmpeg_dst"
  fi
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
patch_ffmpeg_for_youtube
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
