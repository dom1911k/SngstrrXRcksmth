// Entry point, loaded by content/loader.js on songsterr.com pages.
import { loadSettings, onSettingsChange } from './core/settings.js';
import { AudioEngine } from './audio/engine.js';
import { SongsterrAdapter } from './adapters/songsterr/adapter.js';
import { createPanel } from './ui/panel.js';
import { createOverlay } from './ui/overlay.js';
import { createSongSection } from './ui/song-section.js';
import { ScoringSession } from './scoring/session.js';

export async function start() {
  if (document.getElementById('bass-trainer-root')) return; // already running
  await loadSettings();
  const engine = new AudioEngine();
  const adapter = new SongsterrAdapter();
  const session = new ScoringSession(engine, adapter);
  let panel, overlay;
  const songSection = createSongSection(adapter, { onTabTuning: (t) => panel && panel.setTabTuning(t), showSummary: () => overlay && overlay.scoreUI && overlay.scoreUI.showLast() });
  panel = createPanel(engine, { sections: [songSection] });
  overlay = createOverlay(adapter, { session });
  document.documentElement.append(overlay.host, panel.host);
  adapter.start();
  // Exposed for troubleshooting from the DevTools console (extension context).
  globalThis.bassTrainer = { engine, adapter, panel, overlay, session, onSettingsChange };
  return { engine, adapter, panel, overlay, session };
}
