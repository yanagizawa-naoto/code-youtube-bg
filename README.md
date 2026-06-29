# code-youtube-bg

macOS helper that plays a YouTube embed as the background of a dedicated VS Code copy.

It does not modify your normal VS Code app. The installer copies your local Visual Studio Code app to `~/Applications/Code Video BG.app`, patches that copy, and installs a `code-youtube-bg` command.

## Requirements

- macOS
- Visual Studio Code installed
- Homebrew recommended
- YouTube videos you have permission to use

The installer can install this with Homebrew:

- `node`

During install, the dedicated app's `libffmpeg.dylib` is replaced with the matching official Electron build. This is needed because the VS Code-bundled ffmpeg can fail to decode YouTube's Opus audio tracks. Your normal VS Code app is not modified.

## Install

```bash
git clone https://github.com/yanagizawa-naoto/code-youtube-bg.git
cd code-youtube-bg
./install.sh
```

If you already have `~/Applications/Code Video BG.app` and want to replace it:

```bash
./install.sh --force
```

If VS Code is in a custom location:

```bash
CODE_APP_PATH="/path/to/Visual Studio Code.app" ./install.sh
```

Restart your terminal after install, or run:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Usage

Play a YouTube embed with audio:

```bash
CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --audio --volume 0.50 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Open the current folder in the background-enabled app:

```bash
CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --open . --audio --volume 0.50 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Play a YouTube playlist embed:

```bash
CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --audio --volume 0.50 'https://www.youtube.com/playlist?list=PLAYLIST_ID'
```

Use video only:

```bash
CODE_YOUTUBE_BG_OPACITY=0.85 code-youtube-bg --mute 'https://www.youtube.com/watch?v=VIDEO_ID'
```

## Useful Parameters

- `CODE_YOUTUBE_BG_OPACITY=0.75` makes the video more visible.
- `CODE_YOUTUBE_BG_OPACITY=0.90` makes editor text easier to read.
- `--volume 0.50` sets audio volume from `0.0` to `1.0`.
- `--mute` disables audio.
- `--audio` enables audio.
- `--open .` opens a folder or file in `Code Video BG.app`.
- `CODE_YOUTUBE_BG_DEBUG_PORT=9223` changes the local DevTools port used to unlock iframe audio.

## Stop Audio

Run the same video muted:

```bash
code-youtube-bg --mute 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Or quit `Code Video BG.app`.

## Uninstall

```bash
./uninstall.sh
```

Remove app support data too:

```bash
./uninstall.sh --purge
```

## Notes

- This is experimental and macOS-only.
- This public build uses YouTube's embeddable iframe player. It does not download videos or resolve direct media stream URLs.
- Regular Visual Studio Code windows are not modified. Use `--open .` or open `Code Video BG.app` for windows that should show the video background.
- `--audio` starts the dedicated app with a localhost-only DevTools port so the command can perform the same user-gesture click YouTube requires for iframe audio.
- Videos must allow YouTube embedding. Age gates, sign-in checks, regional restrictions, and embedding-disabled videos are handled by YouTube and are not bypassed.
- Playlist URLs are resolved through YouTube's public Atom feed and played as a queue of regular YouTube iframe embeds. This avoids direct media URLs while working around playlist embeds that YouTube rejects.
- VS Code updates can change internal files. Re-run `./install.sh --force` if the dedicated app breaks after an update.
- Respect copyright and YouTube's terms when choosing videos.
