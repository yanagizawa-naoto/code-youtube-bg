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
- Videos must allow YouTube embedding. Age gates, sign-in checks, regional restrictions, and embedding-disabled videos are handled by YouTube and are not bypassed.
- VS Code updates can change internal files. Re-run `./install.sh --force` if the dedicated app breaks after an update.
- Respect copyright and YouTube's terms when choosing videos.
