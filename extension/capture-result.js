(() => {
  const state = globalThis.__apiAnythingCapture;
  if (!state?.ready) throw new Error("Capture hook did not start; this site's CSP may block it");
  if (!state.stopped) throw new Error("Capture hook has not stopped");
  document.removeEventListener(state.channel, state.listener);
  delete globalThis.__apiAnythingCapture;
  return { exchanges: state.exchanges, cookies: [], finalUrl: location.href };
})();
