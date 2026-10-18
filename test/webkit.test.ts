import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  browserAvailable,
  browserChoice,
  closeBrowser,
  headlessUserAgent,
  openBrowser,
  ProfileInUse,
  pageFetch,
  runTrigger,
} from "../src/browser.js";
import { call } from "../src/execute.js";
import { addOperation } from "../src/heal.js";
import { type Fixture, PUBLIC_BEARER, startFixture } from "./fixture/server.js";

const saved = process.env.API_ANYTHING_BROWSER;
const savedHome = process.env.API_ANYTHING_HOME;
const root = mkdtempSync(join(tmpdir(), "api-anything-webkit-"));
process.env.API_ANYTHING_BROWSER = "webkit";
process.env.API_ANYTHING_HOME = root;
after(async () => {
  await closeBrowser();
  if (saved === undefined) delete process.env.API_ANYTHING_BROWSER;
  else process.env.API_ANYTHING_BROWSER = saved;
  if (savedHome === undefined) delete process.env.API_ANYTHING_HOME;
  else process.env.API_ANYTHING_HOME = savedHome;
  rmSync(root, { recursive: true, force: true });
});

describe("Playwright WebKit", {
  skip: !browserAvailable() && "install with npx playwright-core install webkit",
}, () => {
  let fx: Fixture;
  const profileDir = join(root, "browser");
  before(async () => {
    fx = await startFixture();
  });
  after(async () => {
    await closeBrowser();
    await fx.close();
  });

  test("captures actual WebKit responses, wire headers, POST bodies and cookies", async () => {
    const r = await runTrigger({ url: `${fx.url}/u/alice`, profileDir });
    const gql = r.exchanges.find((e) => e.request.url.includes("/UserByName?"));
    assert.ok(gql?.response);
    assert.equal(JSON.parse(gql.response.body!).data.user.name, "alice");
    assert.match(gql.request.headers["user-agent"], /AppleWebKit/);
    assert.doesNotMatch(gql.request.headers["user-agent"], /Chrome/);
    assert.match(gql.request.headers.cookie, /ct0=/);
    assert.equal(gql.request.headers["x-csrf-token"], r.cookies.find((c) => c.name === "ct0")?.value);
    assert.equal(r.finalUrl, `${fx.url}/u/alice`);
    assert.ok(existsSync(`${profileDir}-webkit`));
    assert.equal(existsSync(profileDir), false, "Chromium profile was not opened");

    const search = await runTrigger({ url: `${fx.url}/search?q=pizza`, profileDir });
    const rpc = search.exchanges.find((e) => e.request.url.includes("/api/rpc"));
    assert.equal(rpc?.request.method, "POST");
    assert.match(decodeURIComponent(rpc?.request.body ?? ""), /pizza/);
    assert.equal(rpc?.response?.status, 200);
  });

  test("learns a read using WebKit and replays it with an unseen argument", async () => {
    await addOperation({
      site: "webkit-fixture",
      op: "user",
      trigger: { url: `${fx.url}/u/{name}` },
      examples: [{ name: "alice" }, { name: "bobby" }],
      response: { extract: "data.user", pick: ["name", "followers"] },
      public: ["authorization"],
    });
    const result = await call("webkit-fixture", "user", { name: "carol" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.tier, 1);
    if (result.ok) assert.deepEqual(result.data, { name: "carol", followers: 500 });
  });

  test("soft navigation and UI steps fire the requested read", async () => {
    const r = await runTrigger({ url: `${fx.url}/spa/bob`, softFrom: `${fx.url}/spa/alice`, profileDir });
    assert.equal(r.exchanges.filter((e) => e.resourceType === "document").length, 1);
    assert.ok(r.exchanges.some((e) => e.request.url.endsWith("/api/spa/user?name=bob")));
    const stepped = await runTrigger({
      url: `${fx.url}/spa/alice`,
      steps: [{ action: "click", selector: 'a[href="/spa/bob"]' }],
      profileDir,
    });
    assert.ok(stepped.exchanges.some((e) => e.request.url.endsWith("/api/spa/user?name=bob")));
  });

  test("tier 2 fetch uses WebKit and persists cookies across browser restarts", async () => {
    const r = await runTrigger({ url: `${fx.url}/u/alice`, profileDir });
    const gql = r.exchanges.find((e) => e.request.url.includes("/UserByName?"))!;
    const csrf = r.cookies.find((c) => c.name === "ct0")!.value;
    const ctx = await openBrowser({ profileDir });
    const page = await ctx.newPage();
    await page.goto(fx.url);
    await page.evaluate(() => localStorage.setItem("restart-proof", "preserved"));
    await closeBrowser();
    const stateFile = join(`${profileDir}-webkit`, "api-anything-state.json");
    assert.equal(statSync(stateFile).mode & 0o777, 0o600);
    const result = await pageFetch({
      origin: fx.url,
      url: gql.request.url,
      method: "GET",
      headers: { "x-csrf-token": csrf, authorization: PUBLIC_BEARER },
      profileDir,
    });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).data.user.name, "alice");
    assert.match(String(fx.calls.at(-1)?.headers["user-agent"]), /AppleWebKit/);
    const restored = await (await openBrowser({ profileDir })).newPage();
    await restored.goto(fx.url);
    assert.equal(await restored.evaluate(() => localStorage.getItem("restart-proof")), "preserved");
  });

  test("tier 2 redirects are reported and followed only under the caller's policy", async () => {
    let endHits = 0;
    const server = createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/end" });
        res.end();
      } else {
        if (req.url === "/end") endHits++;
        res.end("done");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const options = { origin, url: `${origin}/redirect`, method: "GET", headers: {}, profileDir };
      const first = await pageFetch(options);
      assert.equal(first.status, 302);
      assert.equal(endHits, 0);
      const followed = await pageFetch({
        ...options,
        redirect: (hop, status, location) => {
          assert.equal(status, 302);
          return { ...hop, url: new URL(location, hop.url).href };
        },
      });
      assert.equal(followed.status, 200);
      assert.equal(followed.body, "done");
      assert.equal(endHits, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("headed login context starts on WebKit", async () => {
    await closeBrowser();
    const ctx = await openBrowser({ profileDir, headless: false });
    const page = await ctx.newPage();
    await page.goto(`${fx.url}/login`);
    assert.match(await page.evaluate(() => navigator.userAgent), /AppleWebKit/);
    await closeBrowser();
  });

  test("WebKit UA cache is separate and rejects a Chromium user agent", async () => {
    const ua = await headlessUserAgent();
    assert.match(ua, /AppleWebKit/);
    const file = join(root, "webkit-ua.json");
    const kept = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...kept, ua: "Chrome/123" }));
    assert.equal(await headlessUserAgent(), ua);
  });

  test("guarded capture refuses before opening a page or sending a request", async () => {
    const untouched = join(root, "must-not-open");
    const before = fx.calls.length;
    await assert.rejects(
      runTrigger({ url: `${fx.url}/compose`, profileDir: untouched, intercept: () => true }),
      /guarded capture is not supported on WebKit/,
    );
    assert.equal(fx.calls.length, before);
    assert.equal(existsSync(`${untouched}-webkit`), false);
  });

  test("WebKit respects a live owner's lock and recovers a lock left by an exited process", async () => {
    await closeBrowser();
    const locked = join(root, "locked");
    const lock = join(`${locked}-webkit`, "api-anything.lock");
    mkdirSync(`${locked}-webkit`, { mode: 0o700 });
    const token = `${process.pid}:another-command`;
    writeFileSync(lock, token);
    await assert.rejects(openBrowser({ profileDir: locked }), ProfileInUse);
    assert.equal(readFileSync(lock, "utf8"), token, "a live owner's lock was not removed");
    const exited = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    assert.equal(exited.status, 0);
    writeFileSync(lock, `${exited.pid}:exited`);
    const ctx = await openBrowser({ profileDir: locked });
    assert.ok(ctx);
    assert.notEqual(readFileSync(lock, "utf8"), `${exited.pid}:exited`);
    await closeBrowser();
    assert.equal(existsSync(lock), false, "managed close releases the lock");
  });

  test("changing engine in one process replaces the context, profile and origin page", async (t) => {
    const webkit = await openBrowser({ profileDir });
    const { chromium: bundled } = await import("playwright-core");
    const bin = bundled.executablePath();
    process.env.API_ANYTHING_BROWSER = existsSync(bin) ? bin : (saved ?? "no-such-browser");
    const chromium = browserChoice();
    if (!chromium || chromium.engine === "webkit") {
      process.env.API_ANYTHING_BROWSER = "webkit";
      return t.skip("no separate Chromium browser installed");
    }
    try {
      const other = await openBrowser({ profileDir });
      assert.notEqual(other, webkit);
      assert.ok(existsSync(profileDir));
      assert.equal(
        (await other.cookies(fx.url)).find((c) => c.name === "ct0"),
        undefined,
      );
      const result = await pageFetch({ origin: fx.url, url: fx.url, method: "GET", headers: {}, profileDir });
      assert.equal(result.status, 200);
    } finally {
      await closeBrowser();
      process.env.API_ANYTHING_BROWSER = "webkit";
    }
  });
});
