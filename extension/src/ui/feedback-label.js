// Text and colour for a scoring result.
export function feedbackLabel(r) {
  if (r.status === 'hit') {
    if (r.rating === 'early') return { text: 'Early', color: '#ffd24a' };
    if (r.rating === 'late') return { text: 'Late', color: '#ffb347' };
    return { text: '✓', color: '#5fd38d' };
  }
  if (r.playedName) return { text: `${r.playedName.replace(/-?\d+$/, '')}?`, color: '#ff6b6b' };
  return { text: '✗', color: '#ff5a5f' };
}

