# code-youtube-bg

macOS helper that plays a YouTube video as the background of a dedicated VS Code copy.

It does not modify your normal VS Code app. The installer copies your local Visual Studio Code app to `~/Applications/Code Video BG.app`, patches that copy, and installs a `code-youtube-bg` command.

## Requirements

- macOS
- Visual Studio Code installed
- Homebrew recommended
- YouTube videos you have permission to use

The installer can install these with Homebrew:

- `node`
- `yt-dlp`
- `mpv`
- `ffmpeg`

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

Stream a YouTube video with audio:

```bash
CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --stream --audio --volume 0.50 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Use video only:

```bash
CODE_YOUTUBE_BG_OPACITY=0.85 code-youtube-bg --stream --mute 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Use adaptive readability mode, which keeps text-heavy areas darker while letting empty editor space show more video:

```bash
CODE_YOUTUBE_BG_ADAPTIVE=1 CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --stream --audio --volume 0.50 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Disable adaptive mode and use the older whole-window opacity behavior:

```bash
CODE_YOUTUBE_BG_ADAPTIVE=0 CODE_YOUTUBE_BG_OPACITY=0.90 code-youtube-bg --stream --audio --volume 0.50 'https://www.youtube.com/watch?v=VIDEO_ID'
```

Use a local downloaded MP4 instead of streaming:

```bash
code-youtube-bg --local --audio 'https://www.youtube.com/watch?v=VIDEO_ID'
```

## Useful Parameters

- `CODE_YOUTUBE_BG_OPACITY=0.75` makes the video more visible.
- `CODE_YOUTUBE_BG_OPACITY=0.90` makes editor text easier to read.
- `CODE_YOUTUBE_BG_ADAPTIVE=1` keeps text and media readable while empty areas show more video.
- `CODE_YOUTUBE_BG_ADAPTIVE=0` uses the legacy whole-window opacity behavior.
- `--volume 0.50` sets audio volume from `0.0` to `1.0`.
- `--mute` disables audio.
- `--audio` enables audio.
- `--audio-delay 0.2` delays audio by 0.2 seconds.
- `--audio-delay -0.2` advances audio by 0.2 seconds.

## Stop Audio

Run the same video muted:

```bash
code-youtube-bg --stream --mute 'https://www.youtube.com/watch?v=VIDEO_ID'
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
- YouTube stream URLs are temporary. Re-run the command when playback stops after a long time.
- VS Code updates can change internal files. Re-run `./install.sh --force` if the dedicated app breaks after an update.
- Respect copyright and YouTube's terms when choosing videos.
