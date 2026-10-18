(() => {
  const state = globalThis.__apiAnythingCapture;
  if (!state) throw new Error("No capture in this document (navigation ends capture)");
  return { ready: state.ready, stopped: state.stopped, requests: state.exchanges.length, url: state.url };
})();
