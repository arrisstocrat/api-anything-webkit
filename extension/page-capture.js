// Runs in the page world. Observational only: this is never a write guard.
(() => {
  const channel = document.currentScript?.dataset.channel;
  if (!channel) return;
  const emit = (value) => document.dispatchEvent(new CustomEvent(channel, { detail: JSON.stringify(value) }));
  const originalFetch = window.fetch;
  const proto = XMLHttpRequest.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalHeader = proto.setRequestHeader;
  const requests = new WeakMap();
  let active = true;
  let count = 0;
  let bytes = 0;
  const pending = new Set();
  const track = (promise) => {
    pending.add(promise);
    void promise.catch(() => {}).finally(() => pending.delete(promise));
  };
  const headers = (h) => Object.fromEntries(new Headers(h).entries());
  const eligible = (method, url) => /^(GET|HEAD)$/.test(method) && /^https?:/.test(url);
  async function responseBody(response) {
    const type = response.headers.get("content-type") ?? "";
    if (!/json|text|xml|javascript|x-www-form-urlencoded/i.test(type)) return undefined;
    const reader = response.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let text = "";
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text + decoder.decode();
        size += value.byteLength;
        if (size > 256_000) return undefined; // Never learn a silently truncated answer.
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
  function record(request, response) {
    if (!active || count >= 40 || response.body === undefined) return;
    const exchange = { id: ++count, resourceType: "fetch", request, response };
    const size = JSON.stringify(exchange).length;
    if (size > 300_000 || bytes + size > 1_000_000) return;
    bytes += size;
    emit({ exchange });
  }
  function wrappedFetch(...args) {
    const [input, init] = args;
    // Do not delay, retry or replace the site's actual request or response.
    const promise = originalFetch.apply(this, args);
    try {
      const request = new Request(input, init);
      if (eligible(request.method, request.url))
        track(
          promise.then(async (response) => {
            const clone = response.clone();
            record(
              { method: request.method, url: request.url, headers: headers(request.headers) },
              {
                status: response.status,
                headers: headers(response.headers),
                contentType: response.headers.get("content-type") ?? "",
                body: await responseBody(clone),
              },
            );
          }),
        );
    } catch {
      /* Observing must not break the site's fetch. */
    }
    return promise;
  }
  function wrappedOpen(...args) {
    const [method, url] = args;
    const result = originalOpen.apply(this, args);
    requests.set(this, { method: String(method).toUpperCase(), url: new URL(url, location.href).href, headers: {} });
    return result;
  }
  function wrappedHeader(...args) {
    const [name, value] = args;
    const result = originalHeader.apply(this, args);
    const r = requests.get(this);
    if (r) {
      const key = String(name).toLowerCase();
      r.headers[key] = r.headers[key] ? `${r.headers[key]}, ${value}` : String(value);
    }
    return result;
  }
  function wrappedSend(...args) {
    const request = requests.get(this);
    if (request && eligible(request.method, request.url)) {
      this.addEventListener(
        "load",
        () => {
          try {
            let body;
            if (!this.responseType || this.responseType === "text") body = this.responseText;
            else if (this.responseType === "json") body = JSON.stringify(this.response);
            if (typeof body !== "string" || body.length > 256_000) return;
            const h = {};
            for (const line of this.getAllResponseHeaders()
              .trim()
              .split(/[\r\n]+/)) {
              const at = line.indexOf(":");
              if (at > 0) h[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
            }
            record(request, { status: this.status, headers: h, contentType: h["content-type"] ?? "", body });
          } catch {
            /* Opaque responses cannot be captured. */
          }
        },
        { once: true },
      );
    }
    return originalSend.apply(this, args);
  }
  window.fetch = wrappedFetch;
  proto.open = wrappedOpen;
  proto.send = wrappedSend;
  proto.setRequestHeader = wrappedHeader;
  async function stop() {
    // Wait only for already observed fetch responses, with a fixed bound.
    await Promise.race([Promise.allSettled([...pending]), new Promise((resolve) => setTimeout(resolve, 1500))]);
    active = false;
    if (window.fetch === wrappedFetch) window.fetch = originalFetch;
    if (proto.open === wrappedOpen) proto.open = originalOpen;
    if (proto.send === wrappedSend) proto.send = originalSend;
    if (proto.setRequestHeader === wrappedHeader) proto.setRequestHeader = originalHeader;
    document.removeEventListener(`${channel}:stop`, stop);
    clearTimeout(expiry);
    emit({ stopped: true });
  }
  document.addEventListener(`${channel}:stop`, stop, { once: true });
  const expiry = setTimeout(() => void stop(), 300_000);
  emit({ ready: true });
})();
