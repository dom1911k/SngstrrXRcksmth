// Link to RS2014converter on this PC (one-click CDLC build).
//
// RS2014converter's setup.bat registers a small helper program with Chrome
// ("native messaging host" com.basstrainer.rs2014converter). The player page talks
// to it: it sends the song folder (song.yaml, the chart and your audio file, in
// chunks), the helper saves it under the converter's "songs" folder and runs
// make_cdlc there, sending the converter's progress lines back.
//
// Messages (JSON): → hello | begin {folder, files:[{name,text}], audio:{name,size}}
//   | chunk {data (base64)} | end | build | open {what:'output'|'dlc'} | cancel
// ← hello {version, songsDir, dlcFolder, wwise} | ready | chunk-ok | saved {dir}
//   | log {line} | step {text} | done {ok, psarc, outDir, checks[], copiedTo, error}

export const HOST = 'com.basstrainer.rs2014converter';
// Installs RS2014converter (no admin rights): Win+R, paste, Enter.
export const INSTALL_COMMAND = 'powershell -NoExit -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/dom1911k/RS2014converter/refs/heads/claude/elegant-brown-1ku0ek/install.ps1 | iex"';
const CHUNK = 4 * 1024 * 1024;   // bytes of audio per message (Chrome allows 64 MB to the helper)

function connect() {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connectNative) return null;
  try { return chrome.runtime.connectNative(HOST); } catch { return null; }
}

// One request/response conversation with the helper.
function session() {
  const port = connect();
  if (!port) return null;
  const waiting = [];
  const listeners = new Set();
  let closed = null;
  port.onMessage.addListener((msg) => {
    for (const fn of listeners) fn(msg);
    const w = waiting.findIndex((x) => x.types.includes(msg.type));
    if (w >= 0) waiting.splice(w, 1)[0].resolve(msg);
    // An error ends every wait (the helper answers a failed step with done {ok: false}).
    else if (msg.type === 'done' && !msg.ok) for (const x of waiting.splice(0)) x.reject(new Error(msg.error || 'the converter helper failed'));
  });
  port.onDisconnect.addListener(() => {
    const err = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'the converter helper stopped';
    closed = err;
    for (const w of waiting.splice(0)) w.reject(new Error(err));
  });
  return {
    send: (m) => { if (closed) throw new Error(closed); port.postMessage(m); },
    next: (types, ms = 0) => new Promise((resolve, reject) => {
      if (closed) { reject(new Error(closed)); return; }
      const w = { types: [].concat(types), resolve, reject };
      waiting.push(w);
      if (ms) setTimeout(() => { const i = waiting.indexOf(w); if (i >= 0) { waiting.splice(i, 1); reject(new Error('no answer from the converter helper')); } }, ms);
    }),
    on: (fn) => listeners.add(fn),
    close: () => { try { port.disconnect(); } catch { /* ignore */ } },
  };
}

// Why the last converterInfo() found nothing: { code, detail } (null after success).
//   code: 'no-permission' (this extension version can't talk to programs) | 'not-found'
//   (helper not registered with Chrome) | 'forbidden' (registered for another extension ID)
//   | 'crashed' (the helper starts but stops) | 'no-answer'
export let lastConverterError = null;

function classify(message) {
  if (/not found/i.test(message)) return 'not-found';
  if (/forbidden/i.test(message)) return 'forbidden';
  if (/exited|communicating|stopped/i.test(message)) return 'crashed';
  return 'no-answer';
}

// Is the converter installed (and its helper registered)? -> hello info or null.
export async function converterInfo() {
  lastConverterError = null;
  const s = session();
  if (!s) {
    lastConverterError = { code: 'no-permission', detail: 'chrome.runtime.connectNative is not available' };
    return null;
  }
  try {
    s.send({ type: 'hello' });
    return await s.next('hello', 4000);
  } catch (err) {
    lastConverterError = { code: classify(err.message), detail: err.message };
    return null;
  } finally {
    s.close();
  }
}

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Send the kit and build it. onEvent(msg) gets every message (log/step/...).
// Resolves with the final 'done' message. Returns { promise, cancel }.
export function buildWithConverter({ folder, files, audioFile }, onEvent = () => {}) {
  const s = session();
  if (!s) return { promise: Promise.reject(new Error('Chrome can\'t reach the converter helper')), cancel: () => {} };
  s.on(onEvent);
  const promise = (async () => {
    try {
      s.send({ type: 'begin', folder, files, audio: audioFile ? { name: audioFile.name, size: audioFile.size } : null });
      await s.next('ready', 10000);
      if (audioFile) {
        for (let pos = 0; pos < audioFile.size; pos += CHUNK) {
          const bytes = new Uint8Array(await audioFile.slice(pos, pos + CHUNK).arrayBuffer());
          s.send({ type: 'chunk', data: toBase64(bytes) });
          await s.next('chunk-ok', 60000);
          onEvent({ type: 'upload', done: Math.min(audioFile.size, pos + CHUNK), total: audioFile.size });
        }
      }
      s.send({ type: 'end' });
      await s.next('saved', 30000);
      s.send({ type: 'build' });
      const done = await s.next('done');
      return done;
    } finally {
      s.close();
    }
  })();
  return { promise, cancel: () => { try { s.send({ type: 'cancel' }); } catch { /* ignore */ } } };
}

// Open the output folder (or the Rocksmith dlc folder) in Explorer.
export async function openConverterFolder(folder, what = 'output') {
  const s = session();
  if (!s) return;
  try { s.send({ type: 'open', folder, what }); await s.next('opened', 4000); } catch { /* ignore */ } finally { s.close(); }
}
