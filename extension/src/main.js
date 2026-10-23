// Entry point, loaded by content/loader.js on songsterr.com pages.
import { loadSettings, onSettingsChange } from './core/settings.js';
import { AudioEngine } from './audio/engine.js';
import { SongsterrAdapter } from './adapters/songsterr/adapter.js';
import { createPanel } from './ui/panel.js';
import { createOverlay } from './ui/overlay.js';
import { createSongSection } from './ui/song-section.js';

export async function start() {
  if (document.getElementById('bass-trainer-root')) return; // already running
  await loadSettings();
  const engine = new AudioEngine();
  const adapter = new SongsterrAdapter();
  let panel;
  const songSection = createSongSection(adapter, { onTabTuning: (t) => panel && panel.setTabTuning(t) });
  panel = createPanel(engine, { sections: [songSection] });
  const overlay = createOverlay(adapter);
  document.documentElement.append(overlay.host, panel.host);
  adapter.start();
  // Exposed for troubleshooting from the DevTools console (extension context).
  globalThis.bassTrainer = { engine, adapter, panel, overlay, onSettingsChange };
  return { engine, adapter, panel, overlay };
}
