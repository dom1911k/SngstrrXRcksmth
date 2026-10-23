// Session flow while the trainer listens (input running): mutes the song's
// bass track and restores it afterwards, and applies the count-in settings.
// Muting uses the adapter's setBassMuted() (Songsterr's own
// mute button). If you unmute the bass yourself while playing, that wins until
// the next start.

import { getSettings } from './settings.js';

export class AutoMute {
  constructor(engine, adapter) {
    this.engine = engine;
    this.adapter = adapter;
    this.mutedByUs = false;
    this.userOverride = false;
    this.busy = false;
    this.mutedAt = 0;
    this.status = '';
    adapter.on('chart', () => { this.mutedByUs = false; this.userOverride = false; });
    window.addEventListener('pagehide', () => { if (this.mutedByUs) adapter.setBassMuted(false); });
    // The trainer's count-in settings are applied whenever the input starts.
    engine.on('state', (st) => {
      if (!st.running) return;
      const s = getSettings();
      adapter.setCountIn({ before: s.countIn, loops: s.countInLoops });
    });
    this.timer = setInterval(() => this.tick(), 500);
  }

  tick() {
    const st = this.adapter.getState();
    if (!st.ready) return;
    const s = getSettings();
    const want = !!(s.autoMuteBass && this.engine.running && this.adapter.getChart());
    if (!want) {
      if (!this.engine.running) this.userOverride = false;
      if (this.mutedByUs && !this.busy) {
        this.busy = true;
        this.adapter.setBassMuted(false).then(() => { this.busy = false; this.mutedByUs = false; this.status = ''; });
      }
      if (!s.autoMuteBass) this.status = '';
      return;
    }
    if (this.userOverride || this.busy || st.bassMuted) return;
    if (this.mutedByUs && performance.now() - this.mutedAt > 1500) {
      this.userOverride = true;
      this.status = 'You turned the bass back on; leaving it on.';
      return;
    }
    if (this.mutedByUs) return;
    if (!st.canMute) {
      this.status = st.videoOpened ? 'Switch Songsterr from ORIG. to SYNTH to mute the bass (the original recording can\'t be split).'
        : st.hasPlus === false ? 'Muting a track needs Songsterr Plus.'
          : st.canMute === false && st.videoOpened === undefined ? 'Your own audio file can\'t be muted per instrument.' : '';
      return;
    }
    this.busy = true;
    this.adapter.setBassMuted(true).then((r) => {
      this.busy = false;
      if (r === 'ok' || r === 'unchanged') {
        this.mutedByUs = true;
        this.mutedAt = performance.now();
        this.status = 'Bass track muted while you play.';
      } else {
        this.status = r === 'video' ? 'Switch Songsterr to SYNTH to mute the bass.' : r === 'no-plus' ? 'Muting a track needs Songsterr Plus.' : 'Could not mute the bass track.';
      }
    });
  }
}
