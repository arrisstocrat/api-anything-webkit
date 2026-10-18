/* global browser, chrome */
const api = globalThis.browser ?? globalThis.chrome;
const config = globalThis.API_ANYTHING_CONNECTOR;
let busy = false;
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
      capabilities: { tabs: true, pageRead: true, guardedCapture: false },
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
  if (c.op !== "read")
    throw new Error("This connector currently supports ping, tabs, open and read. Guarded operations are unavailable.");
  if (!Number.isInteger(c.tabId)) throw new Error("read requires an exact tabId");
  const tab = await deadline(api.tabs.get(c.tabId), "tabs.get");
  const parsed = new URL(tab.url);
  const origin = parsed.origin;
  const permission = `${parsed.protocol}//${parsed.hostname}/*`;
  if (!/^https?:/.test(origin)) throw new Error("Only HTTP(S) pages can be read");
  if (!(await deadline(api.permissions.contains({ origins: [permission] }), "permissions.contains")))
    throw new Error("Grant access to this site's origin using the connector popup first");
  const results = await deadline(api.tabs.executeScript(c.tabId, { file: "read.js" }), "tabs.executeScript");
  return results[0];
}
async function loop() {
  if (!config || busy) return;
  busy = true;
  try {
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
