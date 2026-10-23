// Content scripts cannot be ES modules, so this tiny loader imports the real
// entry point as a module. Everything under src/ is listed as web-accessible.
(async () => {
  try {
    const { start } = await import(chrome.runtime.getURL('src/main.js'));
    start();
  } catch (err) {
    console.error('[Bass Trainer] failed to start', err);
  }
})();
