// Entry point, loaded by content/loader.js on songsterr.com pages.
import { loadSettings, onSettingsChange } from './core/settings.js';
import { AudioEngine } from './audio/engine.js';
import { SongsterrAdapter } from './adapters/songsterr/adapter.js';
import { createPanel } from './ui/panel.js';
import { createOverlay } from './ui/overlay.js';
import { createSongSection } from './ui/song-section.js';
import { ScoringSession } from './scoring/session.js';
import { AutoMute } from './core/auto-mute.js';
import { createPracticeSection } from './ui/practice-section.js';
import { createShortcutActions, installShortcuts } from './core/shortcuts.js';

export async function start() {
  if (document.getElementById('bass-trainer-root')) return; // already running
  await loadSettings();
  const engine = new AudioEngine();
  const adapter = new SongsterrAdapter();
  const session = new ScoringSession(engine, adapter);
  let panel, overlay;
  const songSection = createSongSection(adapter, { onTabTuning: (t) => panel && panel.setTabTuning(t), showSummary: () => overlay && overlay.scoreUI && overlay.scoreUI.showLast() });
  const autoMute = new AutoMute(engine, adapter);
  const practiceSection = createPracticeSection(adapter, autoMute);
  panel = createPanel(engine, { sections: [...practiceSection, ...songSection] });
  overlay = createOverlay(adapter, { session });
  document.documentElement.append(overlay.host, panel.host);
  installShortcuts(createShortcutActions(adapter, { notify: (t) => overlay.notify(t), onToggleView: () => overlay.toggleView() }));
  adapter.start();
  // Exposed for troubleshooting from the DevTools console (extension context).
  globalThis.bassTrainer = { engine, adapter, panel, overlay, session, autoMute, onSettingsChange };
  return { engine, adapter, panel, overlay, session, autoMute };
}
