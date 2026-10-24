// "Start input" from anywhere (highway hint, lessons, fretboard trainer): the
// panel owns the input and does the actual work.
const handlers = new Set();

export function onInputStartRequest(fn) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

export function requestInputStart() {
  for (const fn of handlers) fn();
  return handlers.size > 0;
}
