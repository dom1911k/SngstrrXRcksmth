// "Is it on Ignition?": opens CustomsForge Ignition's own search for a song
// (artist + title) in a new tab and copies the search text to the clipboard,
// in case the search box doesn't fill itself in. No automatic checking:
// Ignition has no public API and blocks automated requests.

export const IGNITION = 'https://ignition4.customsforge.com/';

export function ignitionQuery(artist, title) {
  return [artist, String(title || '').replace(/^Drill: /, '')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function ignitionUrl(artist, title) {
  const q = ignitionQuery(artist, title);
  return q ? `${IGNITION}?search=${encodeURIComponent(q)}` : IGNITION;
}

// Call from a click (clipboard access needs a user gesture).
export function openIgnition(artist, title) {
  const q = ignitionQuery(artist, title);
  try { if (q && navigator.clipboard) navigator.clipboard.writeText(q).catch(() => {}); } catch { /* ignore */ }
  window.open(ignitionUrl(artist, title), '_blank', 'noopener');
  return q;
}
