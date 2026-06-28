#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const videoId = process.argv[2];
const port = Number(process.argv[3] || process.env.CODE_YOUTUBE_BG_PORT || 45173);
const statePath = process.env.CODE_YOUTUBE_BG_STATE_PATH || '';
const ffmpegPath = process.env.CODE_YOUTUBE_BG_FFMPEG || 'ffmpeg';
const mpvPath = process.env.CODE_YOUTUBE_BG_MPV || 'mpv';
const audioLogPath = process.env.CODE_YOUTUBE_BG_AUDIO_LOG || '';
const audioErrPath = process.env.CODE_YOUTUBE_BG_AUDIO_ERR || '';
const audioIpcPath = process.env.CODE_YOUTUBE_BG_AUDIO_IPC || '';
const serverVersion = 16;
const mediaTargets = new Map();
const debugEvents = [];
let lastDebug = null;
let managedAudio = null;

if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) {
  console.error(`Invalid YouTube video ID: ${videoId || ''}`);
  process.exit(2);
}

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error(`Invalid port: ${port}`);
  process.exit(2);
}

process.title = `code-youtube-bg-server ${videoId} ${port}`;

function playerUrl(id) {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    disablekb: '1',
    fs: '0',
    loop: '1',
    playlist: id,
    playsinline: '1',
    rel: '0',
    iv_load_policy: '3',
    enablejsapi: '1',
    origin: `http://127.0.0.1:${port}`,
  });

  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

function page(id, options = {}) {
  const src = playerUrl(id);
  const muted = options.muted !== false;
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1, options.volume)) : 0.35;
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
      title="YouTube background ${id}"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
  </div>
  <script>
    const frame = document.getElementById('player');
    const wantsMuted = ${JSON.stringify(muted)};
    const volume = ${JSON.stringify(volume)};

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

    frame.addEventListener('load', keepPlaying);
    setTimeout(keepPlaying, 300);
    setTimeout(keepPlaying, 1000);
    setInterval(keepPlaying, 3000);
    document.addEventListener('visibilitychange', keepPlaying);
  </script>
</body>
</html>`;
}

function readState() {
  if (!statePath) {
    throw new Error('CODE_YOUTUBE_BG_STATE_PATH is not set');
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function mediaTokenFromState(state) {
  if (state && state.mediaToken) {
    return String(state.mediaToken);
  }

  if (state && state.proxySrc) {
    try {
      const url = new URL(state.proxySrc);
      return url.searchParams.get('token') || url.searchParams.get('t') || '';
    } catch (_) {}
  }

  return state && (state.updatedAt || state.videoId) ? String(state.updatedAt || state.videoId) : '';
}

function mediaKeyIssuedAtMs(mediaKey) {
  const match = String(mediaKey || '').match(/^(\d{10,})-/);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function rememberState(state) {
  if (!state || !state.src) {
    return '';
  }

  const token = mediaTokenFromState(state);
  mediaTargets.set('current', state.src);
  if (token) {
    mediaTargets.set(token, state.src);
  }
  if (state.videoId) {
    mediaTargets.set(`id:${state.videoId}`, state.src);
  }

  while (mediaTargets.size > 16) {
    const first = mediaTargets.keys().next().value;
    if (!first || first === 'current') {
      break;
    }
    mediaTargets.delete(first);
  }

  return token;
}

function proxyMedia(req, res, redirectCount = 0, sourceKey = 'src') {
  let state;
  try {
    state = readState();
    rememberState(state);
  } catch (error) {
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ error: String(error && error.message || error) }) + '\n');
    return;
  }

  const reqUrl = new URL(req.url, `http://127.0.0.1:${port}`);
  const requestToken = reqUrl.searchParams.get('token') || reqUrl.searchParams.get('t') || '';
  const requestVideoId = reqUrl.searchParams.get('v') || '';
  const targetSrc = sourceKey === 'audioSrc'
    ? state.audioSrc || state.src
    : (requestToken && mediaTargets.get(requestToken)) ||
      (requestVideoId && mediaTargets.get(`id:${requestVideoId}`)) ||
      state.src;
  const target = new URL(targetSrc);
  const client = target.protocol === 'http:' ? http : https;
  const headers = {
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Referer': 'https://www.youtube.com/',
  };
  if (req.headers.range) {
    headers.Range = req.headers.range;
  } else if (req.method === 'HEAD') {
    headers.Range = 'bytes=0-1';
  } else {
    headers.Range = 'bytes=0-1048575';
  }

  const upstream = client.request(target, {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
  }, upstreamRes => {
    const location = upstreamRes.headers.location;
    if (
      location &&
      upstreamRes.statusCode &&
      upstreamRes.statusCode >= 300 &&
      upstreamRes.statusCode < 400 &&
      redirectCount < 4
    ) {
      upstreamRes.resume();
      state[sourceKey] = new URL(location, target).toString();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
      rememberState(state);
      proxyMedia(req, res, redirectCount + 1, sourceKey);
      return;
    }

    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Accept-Ranges': upstreamRes.headers['accept-ranges'] || 'bytes',
      'Content-Type': upstreamRes.headers['content-type'] || 'video/mp4',
    };
    for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
      if (upstreamRes.headers[name]) {
        responseHeaders[name] = upstreamRes.headers[name];
      }
    }

    res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    if (req.method === 'HEAD') {
      upstreamRes.resume();
      res.end();
    } else {
      upstreamRes.pipe(res);
    }
  });

  upstream.on('error', error => {
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
    }
    res.end(JSON.stringify({ error: String(error && error.message || error) }) + '\n');
  });

  req.on('close', () => upstream.destroy());
  upstream.end();
}

function proxyMuxedMedia(req, res) {
  let state;
  try {
    state = readState();
    rememberState(state);
  } catch (error) {
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ error: String(error && error.message || error) }) + '\n');
    return;
  }

  const muxSourceMode = state.muxSourceMode === 'single' ? 'single' : 'split';
  if (muxSourceMode !== 'single' && !state.audioSrc) {
    res.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ error: 'No audio stream is available for muxed playback' }) + '\n');
    return;
  }

  const videoSrc = state.muxInputSrc || state.src;
  const audioSrc = state.audioSrc;

  const muxContainer = muxSourceMode === 'single' ? 'mp4' : (state.muxContainer === 'webm' ? 'webm' : 'mp4');
  const contentType = muxContainer === 'webm' ? 'video/webm' : 'video/mp4';

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'none',
    });
    res.end();
    return;
  }

  const outputArgs = muxSourceMode === 'single'
    ? [
      '-map', '0:v:0',
      '-map', '0:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-af', 'aresample=async=1:first_pts=0',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '1024',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    ]
    : muxContainer === 'webm'
    ? [
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-shortest',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '1024',
      '-f', 'webm',
      'pipe:1',
    ]
    : [
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-shortest',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '1024',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    ];

  const args = [
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-reconnect_on_http_error', '403,429,5xx',
    '-user_agent', 'Mozilla/5.0',
    '-headers', 'Accept: */*\r\nReferer: https://www.youtube.com/\r\n',
    '-i', videoSrc,
    ...(muxSourceMode === 'single' ? [] : [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '2',
      '-reconnect_on_http_error', '403,429,5xx',
      '-user_agent', 'Mozilla/5.0',
      '-headers', 'Accept: */*\r\nReferer: https://www.youtube.com/\r\n',
      '-i', audioSrc,
    ]),
    ...outputArgs,
  ];

  const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let ended = false;

  function stopMuxer() {
    if (ended || ffmpeg.killed) {
      return;
    }
    ffmpeg.kill('SIGTERM');
  }

  ffmpeg.on('error', error => {
    ended = true;
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: String(error && error.message || error) }) + '\n');
    } else {
      res.destroy(error);
    }
  });

  ffmpeg.on('close', () => {
    ended = true;
    if (!res.destroyed) {
      res.end();
    }
  });

  ffmpeg.stderr.on('data', chunk => {
    process.stderr.write(`[mux] ${chunk}`);
  });

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'none',
    'X-Content-Type-Options': 'nosniff',
  });

  ffmpeg.stdout.pipe(res);
  req.on('close', stopMuxer);
  res.on('close', stopMuxer);
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function audioVolumeFromState(state) {
  return Math.round(Math.max(0, Math.min(1, safeNumber(state && state.volume, 0.35))) * 100);
}

function audioSourceFromState(state) {
  return state && (state.audioSrc || state.muxInputSrc || state.src || '');
}

function stopManagedAudio() {
  if (!managedAudio) {
    return;
  }

  const current = managedAudio;
  managedAudio = null;

  try {
    current.process.kill('SIGTERM');
  } catch (_) {}

  if (current.ipcPath) {
    setTimeout(() => {
      try {
        fs.unlinkSync(current.ipcPath);
      } catch (_) {}
    }, 500);
  }
}

function mpvCommand(command, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    if (!managedAudio || !managedAudio.ipcPath) {
      reject(new Error('mpv audio is not running'));
      return;
    }

    const socket = net.createConnection(managedAudio.ipcPath);
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('mpv IPC timed out'));
    }, timeoutMs);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(JSON.stringify({ command }) + '\n');
    });
    socket.on('data', chunk => {
      response += chunk;
      if (response.includes('\n')) {
        clearTimeout(timer);
        socket.end();
        try {
          resolve(JSON.parse(response.trim().split('\n').pop()));
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', () => {
      clearTimeout(timer);
    });
  });
}

async function syncManagedAudio(state, debug) {
  if (!managedAudio || !debug || debug.paused || !Number.isFinite(debug.currentTime)) {
    return;
  }

  const now = Date.now();
  if (managedAudio.lastSyncAt && now - managedAudio.lastSyncAt < 700) {
    return;
  }
  managedAudio.lastSyncAt = now;

  const volume = audioVolumeFromState(state);
  if (managedAudio.volume !== volume) {
    managedAudio.volume = volume;
    mpvCommand(['set_property', 'volume', volume]).catch(() => {});
  }

  let audioTime = null;
  try {
    const result = await mpvCommand(['get_property', 'time-pos']);
    audioTime = safeNumber(result && result.data, null);
  } catch (_) {
    return;
  }

  if (!Number.isFinite(audioTime)) {
    return;
  }

  const videoTime = safeNumber(debug.currentTime, 0);
  const drift = videoTime - audioTime;
  managedAudio.lastDrift = drift;
  managedAudio.audioTime = audioTime;
  managedAudio.holdingAudio = false;

  const issuedAt = mediaKeyIssuedAtMs(managedAudio.mediaKey);
  const mediaAge = issuedAt ? now - issuedAt : Infinity;
  if (mediaAge >= 0 && mediaAge < 8000 && audioTime - videoTime > 1.25) {
    managedAudio.recommendedVideoRate = 1;
    managedAudio.targetVideoTime = null;
    managedAudio.targetIssuedAt = 0;
    managedAudio.syncMode = 'startup-ignore-audio-ahead';
    if (managedAudio.lastSpeed !== 1) {
      managedAudio.lastSpeed = 1;
      mpvCommand(['set_property', 'speed', 1]).catch(() => {});
    }
    mpvCommand(['set_property', 'pause', false]).catch(() => {});
    return;
  }

  const absDrift = Math.abs(drift);
  const rateDelta = absDrift < 0.08 ? 0 : clamp(-drift * 0.06, -0.04, 0.04);
  managedAudio.recommendedVideoRate = clamp(1 + rateDelta, 0.96, 1.04);
  managedAudio.syncMode = absDrift < 0.08 ? 'locked' : 'video-rate';

  if (managedAudio.targetIssuedAt && now - managedAudio.targetIssuedAt > 2500) {
    managedAudio.targetVideoTime = null;
    managedAudio.targetIssuedAt = 0;
  }

  if (absDrift > 1.25 && (!managedAudio.lastVideoTargetAt || now - managedAudio.lastVideoTargetAt > 4500)) {
    managedAudio.lastVideoTargetAt = now;
    managedAudio.targetVideoTime = Math.max(0, audioTime);
    managedAudio.targetIssuedAt = now;
    managedAudio.syncMode = 'video-seek';
  }

  if (managedAudio.lastSpeed !== 1) {
    managedAudio.lastSpeed = 1;
    mpvCommand(['set_property', 'speed', 1]).catch(() => {});
  }
  mpvCommand(['set_property', 'pause', false]).catch(() => {});
}

function ensureManagedAudio(state, debug) {
  if (!state || state.muted !== false || state.audioEngine !== 'mpv' || state.inlineAudio === true) {
    stopManagedAudio();
    return;
  }

  if (!debug || debug.paused || safeNumber(debug.readyState, 0) < 2 || !Number.isFinite(debug.currentTime)) {
    return;
  }

  const source = audioSourceFromState(state);
  if (!source || !/^https?:\/\//.test(source)) {
    stopManagedAudio();
    return;
  }

  const mediaKey = String(state.mediaToken || state.updatedAt || source);
  const volume = audioVolumeFromState(state);
  const ipcPath = audioIpcPath || `/tmp/code-youtube-bg-audio-${port}.sock`;
  const issuedAt = mediaKeyIssuedAtMs(mediaKey);
  const mediaAge = issuedAt ? Date.now() - issuedAt : Infinity;
  const startTime = mediaAge >= 0 && mediaAge < 8000 ? 0 : Math.max(0, safeNumber(debug.currentTime, 0));

  if (managedAudio && managedAudio.mediaKey === mediaKey && managedAudio.source === source) {
    syncManagedAudio(state, debug).catch(() => {});
    return;
  }

  stopManagedAudio();

  try {
    fs.unlinkSync(ipcPath);
  } catch (_) {}

  const stdio = ['ignore', 'ignore', 'ignore'];
  let logFd = null;
  let errFd = null;
  try {
    if (audioLogPath) {
      logFd = fs.openSync(audioLogPath, 'a');
      stdio[1] = logFd;
    }
    if (audioErrPath) {
      errFd = fs.openSync(audioErrPath, 'a');
      stdio[2] = errFd;
    }

    const args = [
      '--no-config',
      '--really-quiet',
      '--no-video',
      '--force-window=no',
      '--cache=yes',
      '--demuxer-readahead-secs=20',
      '--audio-buffer=0.5',
      '--loop-file=inf',
      `--volume=${volume}`,
      '--title=code-youtube-bg-audio',
      `--input-ipc-server=${ipcPath}`,
      `--start=${startTime.toFixed(3)}`,
      source,
    ];

    const child = spawn(mpvPath, args, { stdio });
    managedAudio = {
      process: child,
      mediaKey,
      source,
      ipcPath,
      volume,
      startedAt: Date.now(),
      lastSyncAt: 0,
      lastSeekAt: 0,
      lastVideoTargetAt: 0,
      lastSpeed: 1,
      lastDrift: 0,
      audioTime: null,
      recommendedVideoRate: 1,
      targetVideoTime: null,
      targetIssuedAt: 0,
      syncMode: 'starting',
      holdingAudio: false,
    };

    child.on('exit', () => {
      if (managedAudio && managedAudio.process === child) {
        managedAudio = null;
      }
      try {
        fs.unlinkSync(ipcPath);
      } catch (_) {}
      if (logFd !== null) {
        try { fs.closeSync(logFd); } catch (_) {}
      }
      if (errFd !== null) {
        try { fs.closeSync(errFd); } catch (_) {}
      }
    });

    setTimeout(() => syncManagedAudio(state, debug).catch(() => {}), 700);
  } catch (error) {
    if (logFd !== null) {
      try { fs.closeSync(logFd); } catch (_) {}
    }
    if (errFd !== null) {
      try { fs.closeSync(errFd); } catch (_) {}
    }
    stopManagedAudio();
    process.stderr.write(`[audio-sync] ${String(error && error.message || error)}\n`);
  }
}

function audioStatus() {
  if (!managedAudio) {
    return { running: false };
  }
  return {
    running: true,
    pid: managedAudio.process.pid,
    mediaKey: managedAudio.mediaKey,
    volume: managedAudio.volume,
    lastDrift: managedAudio.lastDrift,
    audioTime: managedAudio.audioTime,
    lastSpeed: managedAudio.lastSpeed,
    recommendedVideoRate: managedAudio.recommendedVideoRate,
    targetVideoTime: managedAudio.targetVideoTime,
    targetIssuedAt: managedAudio.targetIssuedAt,
    syncMode: managedAudio.syncMode,
    holdingAudio: managedAudio.holdingAudio,
    startedAt: managedAudio.startedAt,
  };
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
    let currentVideoId = '';
    try {
      const state = readState();
      rememberState(state);
      currentVideoId = state.videoId || '';
    } catch (_) {}

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ ok: true, serverVersion, videoId, currentVideoId, port, hasStatePath: Boolean(statePath), lastDebug, audio: audioStatus() }) + '\n');
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
        const parsed = JSON.parse(body || '{}');
        lastDebug = {
          ...parsed,
          receivedAt: new Date().toISOString(),
        };
        debugEvents.push(lastDebug);
        while (debugEvents.length > 60) {
          debugEvents.shift();
        }
        try {
          ensureManagedAudio(readState(), lastDebug);
        } catch (_) {}
        res.writeHead(204, {
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end();
      } catch (error) {
        res.writeHead(400, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ error: String(error && error.message || error) }) + '\n');
      }
    });
    return;
  }

  if (url.pathname === '/debug.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ lastDebug, audio: audioStatus(), events: debugEvents.slice(-20) }, null, 2) + '\n');
    return;
  }

  if (url.pathname === '/sync.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ audio: audioStatus(), receivedAt: new Date().toISOString() }) + '\n');
    return;
  }

  if (url.pathname === '/state.json') {
    if (!statePath) {
      res.writeHead(404, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: 'CODE_YOUTUBE_BG_STATE_PATH is not set' }) + '\n');
      return;
    }

    try {
      const parsed = readState();
      rememberState(parsed);
      const state = JSON.stringify(parsed, null, 2) + '\n';
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(state);
    } catch (error) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: String(error && error.message || error) }) + '\n');
    }
    return;
  }

  if (url.pathname === '/media') {
    proxyMedia(req, res);
    return;
  }

  if (url.pathname === '/audio') {
    proxyMedia(req, res, 0, 'audioSrc');
    return;
  }

  if (url.pathname === '/mux') {
    proxyMuxedMedia(req, res);
    return;
  }

  let pageVideoId = url.searchParams.get('v') || '';
  let pageMuted = url.searchParams.get('muted') !== '0';
  let pageVolume = Number(url.searchParams.get('volume'));
  if (!/^[A-Za-z0-9_-]{11}$/.test(pageVideoId)) {
    try {
      const state = readState();
      pageVideoId = state.videoId || videoId;
      pageMuted = state.muted !== false;
      pageVolume = Number(state.volume);
    } catch (_) {
      pageVideoId = videoId;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(page(pageVideoId, { muted: pageMuted, volume: pageVolume }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`code-youtube-bg-server listening on http://127.0.0.1:${port}/ for ${videoId}`);
});

function shutdown() {
  stopManagedAudio();
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
