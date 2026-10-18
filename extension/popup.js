/* global browser, chrome */
const api = globalThis.browser ?? globalThis.chrome;
const status = document.querySelector("#status");
const input = document.querySelector("#name");
api.storage.local.get("browserName").then((s) => {
  input.value = s.browserName ?? "";
});
document.querySelector("#connect").onclick = async () => {
  try {
    const name = input.value.trim();
    if (!name) throw new Error("Укажи имя этого браузера");
    const saved = await api.storage.local.get("connectionId");
    await api.storage.local.set({
      connectionId: saved.connectionId ?? crypto.randomUUID(),
      browserName: name,
      connected: true,
    });
    await api.runtime.sendMessage("connect");
    status.textContent = "Подключение включено. В приложении проверь bridge status.";
  } catch (e) {
    status.textContent = e.message;
  }
};
document.querySelector("#disconnect").onclick = async () => {
  await api.storage.local.set({ connected: false });
  status.textContent = "Отключено";
};
document.querySelector("#grant").onclick = async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  try {
    const parsed = new URL(tab.url);
    const origin = parsed.origin;
    const permission = `${parsed.protocol}//${parsed.hostname}/*`;
    if (!/^https?:/.test(origin)) throw new Error("Открой обычный сайт");
    const allowed = await api.permissions.request({ origins: [permission] });
    status.textContent = allowed ? `Разрешено: ${origin}` : "Разрешение не выдано";
  } catch (e) {
    status.textContent = e.message;
  }
};
