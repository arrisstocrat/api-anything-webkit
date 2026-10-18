/** Read-only, localhost-only probe. A protected redirect must never reach its endpoint. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { webkit } from "playwright-core";

let reached = 0;
const intercepted = [];
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<link rel="stylesheet" href="/redirect.css">');
  } else if (req.url === "/redirect.css") {
    res.writeHead(302, { location: "/protected.css" });
    res.end();
  } else if (req.url === "/protected.css") {
    reached++;
    res.writeHead(200, { "content-type": "text/css" });
    res.end("body { color: black }");
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let browser;
try {
  browser = await webkit.launch({
    executablePath: process.env.WEBKIT_EXECUTABLE || undefined,
    headless: true,
  });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname;
    intercepted.push(path);
    if (path === "/protected.css") await route.abort();
    else await route.continue();
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { timeout: 15_000 });
  console.log(JSON.stringify({ engine: browser.version(), intercepted, protectedEndpointHits: reached }, null, 2));
  assert.equal(reached, 0, "WebKit followed a redirect without consulting the guard; guarded runs must stay disabled");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
