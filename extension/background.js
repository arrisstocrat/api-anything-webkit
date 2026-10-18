/* global browser, chrome */
const api = globalThis.browser ?? globalThis.chrome;
const config = globalThis.API_ANYTHING_CONNECTOR;
let busy = false;
let initialized = false;
function deadline(promise, stage) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${stage} did not answer in 5 seconds`)), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function transport(path, value) {
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
  return response.json();
}
async function command(c) {
  if (c.op === "ping")
    return {
      userAgent: navigator.userAgent,
      version: api.runtime.getManifest().version,
      capabilities: {
        tabs: true,
        pageRead: true,
        readCapture: true,
        sessionFetch: true,
        sessionProtocol: 4,
        writeTemplates: true,
        guardedCapture: false,
      },
    };
  if (c.op === "name") {
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 80) throw new Error("invalid connection name");
    await api.storage.local.set({ browserName: c.name.trim() });
    return { name: c.name.trim() };
  }
  if (c.op === "open") {
    const target = new URL(c.url);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Only HTTP(S) navigation is supported");
    const tab = await deadline(api.tabs.create({ url: target.href, active: true }), "tabs.create");
    return { id: tab.id, url: target.href };
  }
  if (c.op === "tabs")
    return (await deadline(api.tabs.query({}), "tabs.query")).map(({ id, title, url }) => ({ id, title, url }));
  if (!["read", "capture-start", "capture-status", "capture-stop", "session-fetch"].includes(c.op))
    throw new Error(
      "This connector supports ping, tabs, open, read and read capture. Guarded operations are unavailable.",
    );
  if (!Number.isInteger(c.tabId)) throw new Error("read requires an exact tabId");
  const tab = await deadline(api.tabs.get(c.tabId), "tabs.get");
  const parsed = new URL(tab.url);
  const origin = parsed.origin;
  const permission = `${parsed.protocol}//${parsed.hostname}/*`;
  if (!/^https?:/.test(origin)) throw new Error("Only HTTP(S) pages can be read");
  if (!(await deadline(api.permissions.contains({ origins: [permission] }), "permissions.contains")))
    throw new Error("Grant access to this site's origin using the connector popup first");
  if (c.op === "session-fetch") {
    const request = globalThis.validateSessionRequest(c.request, origin, c.allowWrites);
    let ready = false;
    const readyUntil = Date.now() + 4000;
    while (Date.now() < readyUntil) {
      const info = (
        await deadline(api.tabs.executeScript(c.tabId, { file: "session-info.js" }), "session readiness")
      )[0];
      if (info?.ready === "complete" && info.origin === origin && info.storage === "function") {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Tab is not ready for a session request; nothing was dispatched");
    const id = crypto.randomUUID();
    try {
      await api.storage.local.set({ __apiAnythingSessionPending: { ...request, id } });
      const started = (
        await deadline(api.tabs.executeScript(c.tabId, { file: "session-fetch.js" }), "session start")
      )[0];
      if (!started?.started) {
        await api.storage.local.remove("__apiAnythingSessionPending");
        throw new Error("Session request setup failed; no retry attempted");
      }
      // Poll only the result. Neither navigation nor timeout ever re-dispatches a request.
      const resultUntil = Date.now() + 18_000;
      while (Date.now() < resultUntil) {
        const result = (
          await deadline(api.tabs.executeScript(c.tabId, { file: "session-result.js" }), "session result")
        )[0];
        if (!result || (result.id !== id && !(result.pending && !result.id)))
          throw new Error("Session request context changed; no retry attempted");
        if (!result.pending) {
          if (result.error || !result.value) throw new Error("Browser request failed; it has not been retried");
          return result.value;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Session request timed out; no retry attempted");
    } finally {
      await api.storage.local.remove("__apiAnythingSessionPending");
    }
  }
  const inject = async (file) => (await deadline(api.tabs.executeScript(c.tabId, { file }), "tabs.executeScript"))[0];
  if (c.op === "capture-stop") {
    await inject("capture-stop.js");
    for (let n = 0; n < 20; n++) {
      const status = await inject("capture-status.js");
      if (status.stopped) return inject("capture-result.js");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Capture did not stop; no result saved");
  }
  if (c.op === "capture-status") return inject("capture-status.js");
  if (c.op === "capture-start") {
    await inject("capture-start.js");
    for (let n = 0; n < 15; n++) {
      const status = await inject("capture-status.js");
      if (status.ready) return status;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await inject("capture-cancel.js");
    throw new Error("Capture hook was blocked (possibly by the site's CSP); no requests captured");
  }
  const results = await deadline(api.tabs.executeScript(c.tabId, { file: "read.js" }), "tabs.executeScript");
  return results[0];
}
async function loop() {
  if (!config || busy) return;
  busy = true;
  try {
    if (!initialized) {
      await api.storage.local.remove("__apiAnythingSessionPending");
      initialized = true;
    }
    let saved = await api.storage.local.get(["connectionId", "browserName", "connected"]);
    if (saved.connected === undefined && config.autoConnect) {
      const name =
        globalThis.KAGI || /Orion/i.test(navigator.userAgent)
          ? "Orion"
          : location.protocol === "safari-web-extension:"
            ? "Safari"
            : "Browser";
      saved = { connectionId: crypto.randomUUID(), browserName: name, connected: true };
      await api.storage.local.set(saved);
    }
    if (!saved.connected) return;
    const id = saved.connectionId;
    await transport("/extension/hello", { id, name: saved.browserName, userAgent: navigator.userAgent });
    for (let i = 0; i < 40; i++) {
      if (!(await api.storage.local.get("connected")).connected) break;
      const task = await transport(`/extension/poll?id=${encodeURIComponent(id)}`);
      if (task) {
        let result;
        try {
          result = { id: task.id, value: await command(task.command) };
        } catch (e) {
          result = { id: task.id, error: e.message };
        }
        await transport(`/extension/result?id=${encodeURIComponent(id)}`, result);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch {
    /* The next poll reconnects; a dispatched command is never replayed. */
  } finally {
    busy = false;
  }
}
api.runtime.onMessage.addListener((message) => {
  if (message === "connect") void loop();
});
setInterval(() => void loop(), 1000);
void loop();
