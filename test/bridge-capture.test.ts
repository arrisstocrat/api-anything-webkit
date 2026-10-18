import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { parseReadCapture } from "../src/bridge-capture.js";
import { learnOperation } from "../src/learn.js";

class DetailEvent extends Event {
  detail: string;
  constructor(type: string, init: { detail: string }) {
    super(type);
    this.detail = init.detail;
  }
}

test("page observer preserves fetch promise and body, learns reads, excludes POST, and restores originals", async () => {
  const doc = Object.assign(new EventTarget(), { currentScript: { dataset: { channel: "test" } } });
  const records: unknown[] = [];
  doc.addEventListener("test", (event) => records.push(JSON.parse((event as DetailEvent).detail)));
  const calls: string[] = [];
  let promise: Promise<Response>;
  const original = (url: string, _init?: RequestInit) => {
    calls.push(url);
    promise = Promise.resolve(
      new Response(JSON.stringify({ items: [{ query: new URL(url).searchParams.get("q") }] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    return promise;
  };
  class XHR {
    open() {}
    send() {}
    setRequestHeader() {}
  }
  const win = { fetch: original };
  const context = createContext({
    window: win,
    document: doc,
    XMLHttpRequest: XHR,
    Request,
    Headers,
    CustomEvent: DetailEvent,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    location: { href: "http://127.0.0.1/" },
  });
  runInContext(readFileSync(new URL("../extension/page-capture.js", import.meta.url), "utf8"), context);
  assert.notEqual(win.fetch, original);
  for (const q of ["alpha", "bravo"]) {
    const returned = win.fetch(`http://127.0.0.1/api/search?q=${q}`);
    assert.equal(returned, promise!);
    assert.equal((await (await returned).json()).items[0].query, q);
  }
  await win.fetch("http://127.0.0.1/api/write", { method: "POST" } as never);
  const stopped = new Promise<void>((resolve) =>
    doc.addEventListener("test", (event) => {
      if (JSON.parse((event as DetailEvent).detail).stopped) resolve();
    }),
  );
  doc.dispatchEvent(new DetailEvent("test:stop", { detail: "" }));
  await stopped;
  assert.equal(win.fetch, original);
  assert.equal(calls.length, 3, "observer never repeats a request");
  const exchanges = records.flatMap((r) =>
    (r as { exchange?: unknown }).exchange ? [(r as { exchange: unknown }).exchange] : [],
  );
  const capture = parseReadCapture({ finalUrl: "http://127.0.0.1/", cookies: [], exchanges });
  assert.equal(capture.exchanges.length, 2);
  const learned = learnOperation({
    name: "search",
    exchanges: [capture.exchanges[0]!],
    exchanges2: [capture.exchanges[1]!],
    examples: [{ q: "alpha" }, { q: "bravo" }],
    cookies: [],
    trigger: { url: "http://127.0.0.1/" },
    readOnly: true,
  });
  assert.deepEqual(
    learned.operation.params.map((p) => p.name),
    ["q"],
  );
  assert.equal(learned.operation.readOnly, true);
});

test("page records cannot claim write interception, inject POST, duplicate ids, or oversized bodies", () => {
  const exchange = {
    id: 1,
    resourceType: "fetch",
    request: { method: "GET", url: "http://127.0.0.1/api", headers: {} },
    response: { status: 200, headers: {}, contentType: "application/json", body: "{}" },
  };
  const capture = { finalUrl: "http://127.0.0.1/", cookies: [], exchanges: [exchange], write: true };
  assert.equal("write" in parseReadCapture(capture), false);
  assert.throws(() => parseReadCapture({ ...capture, exchanges: [exchange, exchange] }), /duplicate/);
  assert.throws(() =>
    parseReadCapture({ ...capture, exchanges: [{ ...exchange, request: { ...exchange.request, method: "POST" } }] }),
  );
  assert.throws(() =>
    parseReadCapture({
      ...capture,
      exchanges: [{ ...exchange, response: { ...exchange.response, body: "x".repeat(256001) } }],
    }),
  );
});
