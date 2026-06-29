#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');

const targetId = process.argv[2];
const port = Number(process.argv[3] || process.env.CODE_YOUTUBE_BG_PORT || 45173);
const statePath = process.env.CODE_YOUTUBE_BG_STATE_PATH || '';
const serverVersion = 19;
let lastDebug = null;

if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetId || '')) {
  console.error(`Invalid YouTube target ID: ${targetId || ''}`);
  process.exit(2);
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(2);
}

process.title = `code-youtube-bg-server ${targetId} ${port}`;

function readState() {
  if (!statePath) {
    return null;
  }

  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function isVideoId(value) {
  return /^[A-Za-z0-9_-]{11}$/.test(value || '');
}

function isPlaylistId(value) {
  return /^[A-Za-z0-9_-]{12,128}$/.test(value || '');
}

function uniqueVideoIds(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (isVideoId(value) && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function youtubeVideoEmbedUrl(videoId, options = {}) {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    disablekb: '1',
    fs: '0',
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    enablejsapi: '1',
    origin: `http://127.0.0.1:${port}`,
  });

  if (!videoId) {
    throw new Error('Missing YouTube video ID');
  }

  if (options.loop) {
    params.set('loop', '1');
    params.set('playlist', videoId);
  }

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function page(target, options = {}) {
  const muted = options.muted !== false;
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1, options.volume)) : 0;
  const playlistVideoIds = uniqueVideoIds(target.playlistVideoIds);
  if (isVideoId(target.videoId) && !playlistVideoIds.includes(target.videoId)) {
    playlistVideoIds.unshift(target.videoId);
  }
  const isQueue = target.kind === 'playlist' && playlistVideoIds.length > 1;
  const startIndex = Math.max(0, playlistVideoIds.indexOf(target.videoId));
  const currentVideoId = playlistVideoIds[startIndex] || target.videoId;
  const src = youtubeVideoEmbedUrl(currentVideoId, { loop: !isQueue });
  const titleId = target.playlistId || target.videoId || targetId;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>Code YouTube Background</title>
  <style>
    html, body, #stage {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #000;
    }

    #player {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 177.7778vh;
      height: 100vh;
      min-width: 100vw;
      min-height: 56.25vw;
      transform: translate(-50%, -50%);
      border: 0;
      background: #000;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <div id="stage">
    <iframe
      id="player"
      src="${src}"
      title="YouTube background ${titleId}"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
  </div>
  <script>
    const frame = document.getElementById('player');
    const wantsMuted = ${JSON.stringify(muted)};
    const volume = ${JSON.stringify(volume)};
    const playlist = ${JSON.stringify(playlistVideoIds)};
    let playlistIndex = ${JSON.stringify(startIndex)};
    let lastAdvanceAt = 0;

    function videoSrc(id) {
      const params = new URLSearchParams({
        autoplay: '1',
        mute: '1',
        controls: '0',
        disablekb: '1',
        fs: '0',
        playsinline: '1',
        rel: '0',
        iv_load_policy: '3',
        enablejsapi: '1',
        origin: location.origin
      });
      if (playlist.length <= 1) {
        params.set('loop', '1');
        params.set('playlist', id);
      }
      return 'https://www.youtube.com/embed/' + encodeURIComponent(id) + '?' + params.toString();
    }

    function postCommand(func, args) {
      try {
        frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), '*');
      } catch (_) {}
    }

    function keepPlaying() {
      postCommand('setVolume', [Math.round(volume * 100)]);
      postCommand(wantsMuted ? 'mute' : 'unMute');
      postCommand('playVideo');
    }

    function advancePlaylist() {
      if (playlist.length <= 1) return;
      const now = Date.now();
      if (now - lastAdvanceAt < 1500) return;
      lastAdvanceAt = now;
      playlistIndex = (playlistIndex + 1) % playlist.length;
      frame.src = videoSrc(playlist[playlistIndex]);
    }

    window.addEventListener('message', event => {
      if (!String(event.origin || '').endsWith('youtube.com')) return;
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) { return; }
      }
      if (data && data.event === 'onStateChange' && data.info === 0) {
        advancePlaylist();
      }
    });

    frame.addEventListener('load', keepPlaying);
    setTimeout(keepPlaying, 300);
    setTimeout(keepPlaying, 1000);
    setInterval(keepPlaying, 3000);
    document.addEventListener('visibilitychange', keepPlaying);
  </script>
</body>
</html>`;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body, null, 2) + '\n');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    });
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    let currentTargetId = targetId;
    let currentVideoId = '';
    let currentPlaylistId = '';
    try {
      const state = readState();
      currentVideoId = state && state.videoId || '';
      currentPlaylistId = state && state.playlistId || '';
      currentTargetId = state && (state.targetId || state.playlistId || state.videoId) || targetId;
    } catch (_) {}

    json(res, 200, {
      ok: true,
      serverVersion,
      targetId,
      currentTargetId,
      currentVideoId,
      currentPlaylistId,
      port,
      hasStatePath: Boolean(statePath),
      lastDebug,
    });
    return;
  }

  if (url.pathname === '/state.json') {
    try {
      const state = readState();
      if (!state) {
        json(res, 404, { error: 'CODE_YOUTUBE_BG_STATE_PATH is not set' });
        return;
      }

      json(res, 200, state);
    } catch (error) {
      json(res, 500, { error: String(error && error.message || error) });
    }
    return;
  }

  if (url.pathname === '/debug' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        lastDebug = {
          ...JSON.parse(body || '{}'),
          receivedAt: new Date().toISOString(),
        };
        res.writeHead(204, {
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end();
      } catch (error) {
        json(res, 400, { error: String(error && error.message || error) });
      }
    });
    return;
  }

  if (url.pathname === '/debug.json') {
    json(res, 200, { lastDebug });
    return;
  }

  let state = null;
  try {
    state = readState();
  } catch (_) {}

  let pageKind = url.searchParams.get('kind') === 'playlist' || state && state.kind === 'playlist' ? 'playlist' : 'video';
  let pageVideoId = url.searchParams.get('v') || state && state.videoId || '';
  let pagePlaylistId = url.searchParams.get('list') || state && state.playlistId || '';
  let pagePlaylistVideoIds = state && state.playlistVideoIds || [];
  let pageMuted = url.searchParams.get('muted') !== '0';
  let pageVolume = Number(url.searchParams.get('volume'));
  if (
    (pageKind === 'video' && !isVideoId(pageVideoId)) ||
    (pageKind === 'playlist' && !isPlaylistId(pagePlaylistId))
  ) {
    try {
      pageKind = state && state.kind === 'playlist' ? 'playlist' : 'video';
      pageVideoId = state && state.videoId || '';
      pagePlaylistId = state && state.playlistId || '';
      pagePlaylistVideoIds = state && state.playlistVideoIds || [];
      pageMuted = state && state.muted !== false;
      pageVolume = Number(state && state.volume);
    } catch (_) {
      pageKind = 'video';
      pageVideoId = isVideoId(targetId) ? targetId : '';
      pagePlaylistId = '';
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(page({
    kind: pageKind,
    videoId: pageVideoId,
    playlistId: pagePlaylistId,
    playlistVideoIds: pagePlaylistVideoIds,
  }, { muted: pageMuted, volume: pageVolume }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`code-youtube-bg-server listening on http://127.0.0.1:${port}/ for ${targetId}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
