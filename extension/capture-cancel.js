(() => {
  const state = globalThis.__apiAnythingCapture;
  if (state) {
    document.dispatchEvent(new CustomEvent(`${state.channel}:stop`));
    document.removeEventListener(state.channel, state.listener);
    delete globalThis.__apiAnythingCapture;
  }
  return { cancelled: true };
})();
