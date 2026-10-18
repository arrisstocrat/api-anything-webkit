// Isolated extension world; results are polled without ever re-dispatching the request.
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (globalThis.__apiAnythingSessionJob?.pending) throw new Error("Session request is busy");
  const job = { pending: true };
  globalThis.__apiAnythingSessionJob = job;
  async function send(input) {
    if (!input || new URL(input.url).origin !== location.origin) throw new Error("Request no longer matches this tab");
    if (input.write && navigator.serviceWorker?.controller)
      throw new Error("Writes are refused on service-worker-controlled pages");
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let body = "";
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            body += decoder.decode();
            break;
          }
          size += value.byteLength;
          if (size > 1_000_000) throw new Error("Response exceeds 1 MB; request was not retried");
          body += decoder.decode(value, { stream: true });
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      url: response.url,
      transport: "installed-browser",
    };
  }

  void (async () => {
    const saved = await api.storage.local.get("__apiAnythingSessionPending");
    const input = saved.__apiAnythingSessionPending;
    await api.storage.local.remove("__apiAnythingSessionPending");
    if (!input?.id) throw new Error("No pending session request");
    job.id = input.id;
    return send(input);
  })().then(
    (value) => {
      job.value = value;
      job.pending = false;
    },
    () => {
      job.error = "Browser request failed; outcome may be unknown";
      job.pending = false;
    },
  );
  return { started: true };
})();
