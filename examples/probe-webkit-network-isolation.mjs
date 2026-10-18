/** Diagnostic, macOS only. Expected to FAIL on the tested WebKit; never a production guard. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webkit } from "playwright-core";

if (process.platform !== "darwin") throw new Error("This diagnostic checks macOS sandbox-exec only");
const dir = mkdtempSync(join(tmpdir(), "aa-webkit-isolation-"));
const launcher = join(dir, "launch.sh");
writeFileSync(
  launcher,
  '#!/bin/sh\nexec /usr/bin/sandbox-exec -p \'(version 1)(allow default)(deny network-outbound)\' "$AA_WEBKIT_EXECUTABLE" "$@"\n',
  { mode: 0o700 },
);
let httpHits = 0,
  webSocketUpgradeHits = 0;
const server = createServer((_req, res) => {
  httpHits++;
  res.setHeader("access-control-allow-origin", "*");
  res.end("local diagnostic");
});
server.on("upgrade", (_req, socket) => {
  webSocketUpgradeHits++;
  socket.destroy();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await webkit.launch({
    executablePath: launcher,
    headless: true,
    timeout: 10000,
    env: { ...process.env, AA_WEBKIT_EXECUTABLE: webkit.executablePath() },
  });
  const page = await browser.newPage();
  await page.evaluate(async (base) => {
    await Promise.allSettled([
      fetch(`${base}/probe`, { method: "POST", body: "local-test", signal: AbortSignal.timeout(2000) }),
      new Promise((resolve) => {
        const socket = new WebSocket(`${base.replace("http:", "ws:")}/socket`);
        socket.onopen = () => {
          socket.close();
          resolve();
        };
        socket.onerror = resolve;
        setTimeout(resolve, 2200);
      }),
    ]);
  }, base);
  const networkIsolation = httpHits === 0 && webSocketUpgradeHits === 0;
  console.log(JSON.stringify({ networkIsolation, httpHits, webSocketUpgradeHits }));
  if (!networkIsolation) process.exitCode = 2;
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
}
