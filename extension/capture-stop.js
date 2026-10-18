(() => {
  const state = globalThis.__apiAnythingCapture;
  if (!state) throw new Error("No capture in this document (navigation ends capture)");
  document.dispatchEvent(new CustomEvent(`${state.channel}:stop`));
  return { stopping: true };
})();
