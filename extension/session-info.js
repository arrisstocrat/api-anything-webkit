(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  return {
    ready: document.readyState,
    origin: location.origin,
    storage: typeof api?.storage?.local?.get,
    runtime: typeof api?.runtime?.getURL,
    pending: globalThis.__apiAnythingSessionJob?.pending ?? false,
    fetch: typeof fetch,
  };
})();
