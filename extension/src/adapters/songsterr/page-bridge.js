// Songsterr page bridge. Runs in the PAGE's JavaScript world (manifest
// "world": "MAIN") because Songsterr's app state is only reachable from there.
//
// This file and the other files in adapters/songsterr/ are the ONLY code that
// knows about Songsterr's internals. If Songsterr changes their site, fix it
// here.
//
// What it uses (verified October 2026):
//   - The app store: an object passed as `props.store` to top-level Preact
//     components; found by walking the Preact vnode tree from #root.__k.
//     store.get() -> state, store.dispatch(event, payload).
//   - state.player.instance.getCursor()  -> playback position in "tab ms"
//     (works for both the synth AudioPlayer and the original-recording video player)
//   - state.player.{shouldPlay, speed, isCountin, isLoading}
//   - state.cursor.position.{cursor, loopStart, loopEnd}   (tab ms; 0/0 = no loop)
//   - state.part.current: the displayed track, with measures[].beatsLayouts[]
//     and timestamps[] (one per beat layout in playback order, tab ms)
//   - state.playings.metronomeTimeline: beats {timestamp, beatNum, bpm, signature}
//   - dispatch('player/togglePlay', {shouldPlay}), dispatch('cursor/move', {cursor, loopStart, loopEnd}),
//     dispatch('player/changeSpeed', {speed})
//
// Protocol with the extension (window.postMessage, same window):
//   bridge -> extension: { source: 'bass-trainer-bridge', type: 'tick' | 'song' | 'status', ... }
//   extension -> bridge: { source: 'bass-trainer-ext', type: 'getSong' | 'command', ... }

(() => {
  if (window.__bassTrainerBridge) return;
  window.__bassTrainerBridge = true;

  const SRC = 'bass-trainer-bridge';
  const BRIDGE_VERSION = 1;
  let store = null;
  let lastPart = null;
  let partGeneration = 0;
  let lastStatus = '';

  const post = (msg) => window.postMessage({ source: SRC, ...msg }, location.origin);

  function findStore() {
    const root = document.getElementById('root');
    if (!root || !root.__k) return null;
    const seen = new Set();
    const stack = [root.__k];
    let steps = 0;
    while (stack.length && steps++ < 20000) {
      const v = stack.pop();
      if (!v || typeof v !== 'object' || seen.has(v)) continue;
      seen.add(v);
      const s = v.props && v.props.store;
      if (s && typeof s.dispatch === 'function' && typeof s.get === 'function') {
        try { if (s.get().player) return s; } catch { /* keep looking */ }
      }
      const kids = v.__k;
      if (Array.isArray(kids)) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return null;
  }

  function status(state, detail = '') {
    const key = state + detail;
    if (key === lastStatus) return;
    lastStatus = key;
    post({ type: 'status', state, detail, bridgeVersion: BRIDGE_VERSION });
  }

  function getState() {
    if (!store) {
      store = findStore();
      if (!store) { status('searching', 'Looking for the Songsterr player…'); return null; }
    }
    try {
      const s = store.get();
      if (!s || !s.player) throw new Error('no player state');
      return s;
    } catch (err) {
      store = null;
      status('searching', 'Lost the Songsterr player; reconnecting…');
      return null;
    }
  }

  // ---------- per-frame tick ----------
  function tick() {
    requestAnimationFrame(tick);
    const s = getState();
    if (!s) return;
    const route = s.route && s.route.page;
    if (route !== 'tab') { status('no-tab', 'Open a tab page to use the trainer.'); return; }
    const p = s.part && s.part.current;
    if (!p || !p.timestamps) { status('loading', 'Waiting for the tab to load…'); return; }
    if (p !== lastPart) { lastPart = p; partGeneration++; }

    const pl = s.player;
    const inst = pl.instance;
    let cursor = s.cursor && s.cursor.position ? s.cursor.position.cursor : 0;
    try {
      if (inst && typeof inst.getCursor === 'function') cursor = inst.getCursor();
    } catch { /* fall back to store cursor */ }
    const pos = (s.cursor && s.cursor.position) || {};
    status('ok', '');
    post({
      type: 'tick',
      perf: performance.now(),
      cursor,
      playing: !!pl.shouldPlay && !pl.isCountin && !pl.isLoading,
      shouldPlay: !!pl.shouldPlay,
      countIn: !!pl.isCountin,
      loading: !!pl.isLoading,
      speed: pl.speed || 100,
      loopStart: pos.loopStart || 0,
      loopEnd: pos.loopEnd || 0,
      songId: s.meta && s.meta.current ? s.meta.current.songId : 0,
      revisionId: p.revisionId || 0,
      partId: s.part.partId,
      partGeneration,
      playerType: inst ? inst.playerType || '' : '',
      latencyOffsetMs: s.audioLatencyOffset ? s.audioLatencyOffset.ms || 0 : 0,
      partsMute: pl.partsMute || [],
    });
  }

  // ---------- song extract (plain data, no Songsterr object references) ----------
  const NOTE_SKIP = new Set(['beat', 'index', 'notationSpace', 'mergedBendPoints', 'rest']);

  function plainNote(n) {
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (NOTE_SKIP.has(k)) continue;
      if (v === null || typeof v !== 'object') out[k] = v;
      else if (k === 'bend') out.bend = true;
      else if (Array.isArray(v) && v.every((x) => typeof x !== 'object')) out[k] = v;
    }
    if (n.mergedBendPoints || n.bend) out.bend = true;
    return out;
  }

  function extract(s) {
    const p = s.part.current;
    const meta = s.meta.current || {};
    const measures = p.measures.map((m, i) => ({
      index: i,
      signature: m.signature,
      marker: m.marker ? m.marker.text : undefined,
      repeatStart: !!m.repeatStart,
      repeat: m.repeat || 0,
      alternateEnding: m.alternateEnding || undefined,
      totalTicks: m.totalTicks,
      layouts: (m.beatsLayouts || []).map((bl) => ({
        beats: bl.beats.map((b) => ({
          voice: b.voice || 0,
          startTick: b.startTick,
          durationInTicks: b.durationInTicks,
          rest: !!b.rest,
          graceNote: b.graceNote || undefined,
          palmMute: !!b.palmMute,
          letRing: !!b.letRing,
          harmonic: b.harmonic ? String(b.harmonic.type || b.harmonic) : undefined,
          tuplet: b.tuplet || undefined,
          notes: (b.notes || []).filter((n) => !n.rest).map(plainNote),
        })),
      })),
    }));
    const metro = (s.playings && s.playings.metronomeTimeline) || [];
    return {
      bridgeVersion: BRIDGE_VERSION,
      songId: meta.songId,
      revisionId: p.revisionId,
      partId: s.part.partId,
      partGeneration,
      title: meta.title,
      artist: meta.artist,
      tracks: (meta.tracks || []).map((t, i) => ({
        partId: t.partId !== undefined ? t.partId : i,
        name: t.name, instrument: t.instrument, tuning: t.tuning || null,
        isBassGuitar: !!t.isBassGuitar, isDrums: !!t.isDrums, isEmpty: !!t.isEmpty,
      })),
      part: {
        name: p.name,
        instrument: p.instrument,
        tuning: p.tuning,
        strings: p.strings,
        frets: p.frets,
        capo: p.capo || 0,
        tpqn: p.tpqn,
        measures,
        timestamps: Array.from(p.timestamps),
      },
      metronome: metro.map((b) => ({ t: b.timestamp, beatNum: b.beatNum, accented: !!b.accented, bpm: b.bpm, signature: b.signature })),
    };
  }

  // ---------- commands from the extension ----------
  function command(cmd, args = {}) {
    const s = getState();
    if (!s) return;
    const pos = s.cursor.position;
    switch (cmd) {
      case 'play': store.dispatch('player/togglePlay', { shouldPlay: true }); break;
      case 'pause': store.dispatch('player/togglePlay', { shouldPlay: false }); break;
      case 'seek': store.dispatch('cursor/move', { ...pos, cursor: args.ms }); break;
      case 'setLoop': store.dispatch('cursor/move', { ...pos, cursor: args.startMs, loopStart: args.startMs, loopEnd: args.endMs }); break;
      case 'clearLoop': store.dispatch('cursor/move', { ...pos, loopStart: 0, loopEnd: 0 }); break;
      case 'setSpeed': store.dispatch('player/changeSpeed', { speed: args.speed }); break;
      case 'switchPart': {
        const songId = s.meta.current.songId;
        location.assign(location.pathname.replace(/-s\d+(t\d+)?$/, `-s${songId}t${args.partId}`));
        break;
      }
      default: break;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'bass-trainer-ext') return;
    const msg = e.data;
    if (msg.type === 'getSong') {
      const s = getState();
      if (!s || !s.part || !s.part.current) return post({ type: 'song', requestId: msg.requestId, error: 'Tab not loaded yet' });
      try {
        post({ type: 'song', requestId: msg.requestId, song: extract(s) });
      } catch (err) {
        post({ type: 'song', requestId: msg.requestId, error: String(err && err.message || err) });
      }
    } else if (msg.type === 'command') {
      try { command(msg.cmd, msg.args); } catch (err) { post({ type: 'status', state: 'error', detail: String(err.message || err) }); }
    }
  });

  requestAnimationFrame(tick);
})();
