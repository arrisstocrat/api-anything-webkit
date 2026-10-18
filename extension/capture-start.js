/* global browser, chrome */
(() => {
  if (globalThis.__apiAnythingCapture) throw new Error("A capture is already active in this document");
  const channel = `api-anything-${crypto.randomUUID()}`;
  const state = { channel, exchanges: [], ready: false, stopped: false, url: location.href };
  let bytes = 0;
  const listener = (event) => {
    if (typeof event.detail !== "string" || event.detail.length > 310_000) return;
    try {
      const message = JSON.parse(event.detail);
      if (message.ready) state.ready = true;
      if (message.stopped) state.stopped = true;
      if (message.exchange && state.exchanges.length < 40 && bytes + event.detail.length <= 1_050_000) {
        bytes += event.detail.length;
        state.exchanges.push(message.exchange);
      }
    } catch {
      /* Page messages are untrusted data, never commands. */
    }
  };
  state.listener = listener;
  globalThis.__apiAnythingCapture = state;
  document.addEventListener(channel, listener);
  const script = document.createElement("script");
  script.dataset.channel = channel;
  script.src = (globalThis.browser ?? globalThis.chrome).runtime.getURL("page-capture.js");
  script.onload = script.onerror = () => script.remove();
  document.documentElement.append(script);
  return { started: true, url: state.url };
})();
