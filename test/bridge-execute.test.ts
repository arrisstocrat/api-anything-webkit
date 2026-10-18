import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { callInBrowser } from "../src/bridge-execute.js";
import { OperationSchema } from "../src/spec.js";

const op = OperationSchema.parse({
  name: "search",
  readOnly: true,
  request: { method: "GET", url: "http://127.0.0.1/api?q=alpha", headers: {} },
  trigger: { url: "http://127.0.0.1/" },
  params: [{ name: "q" }],
  slots: [{ param: "q", at: ["query:q"] }],
  response: { format: "json", extract: "items" },
});
const session = { cookies: [], values: {} };
const target = { peer: "Safari", tabId: 1 };

test("installed browser transport fills a stored request and returns classified data without fallback", async () => {
  let calls = 0;
  const result = await callInBrowser(op, { q: "charlie" }, session, target, false, async (peer, c) => {
    calls++;
    assert.equal(peer, "Safari");
    assert.equal(c.tabId, 1);
    assert.equal(c.allowWrites, false);
    assert.equal((c.request as { url: string }).url, "http://127.0.0.1/api?q=charlie");
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"items":[{"q":"charlie"}]}',
      url: "http://127.0.0.1/api?q=charlie",
    };
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, [{ q: "charlie" }]);
});

test("writes need explicit permission and every ambiguous response is dispatched at most once", async () => {
  const write = { ...op, readOnly: false, request: { ...op.request, method: "POST" } };
  let calls = 0;
  const fail = async () => {
    calls++;
    throw Error("secret-session-value must never appear in an error");
  };
  assert.equal((await callInBrowser(write, { q: "alpha" }, session, target, false, fail)).class, "refused");
  assert.equal(calls, 0);
  const unknown = await callInBrowser(write, { q: "alpha" }, session, target, true, fail);
  assert.equal(calls, 1);
  assert.equal(unknown.ok, false);
  assert.match(unknown.reason!, /unknown/);
  assert.equal(JSON.stringify(unknown).includes("secret-session-value"), false);
  const rejected = await callInBrowser(write, { q: "alpha" }, session, target, true, async () => {
    calls++;
    return { status: 401, headers: {}, body: "", url: op.request.url };
  });
  assert.equal(calls, 2);
  assert.equal(rejected.ok, false);
  assert.match(rejected.next!, /once/);
  assert.equal(
    (await callInBrowser({ ...op, minTier: 3 }, { q: "alpha" }, session, target, false, fail)).class,
    "blocked",
  );
  assert.equal(calls, 2);
});

test("extension rejects cross-origin targets, spoofed cookies, header injection and implicit write classification", () => {
  const context = createContext({ URL });
  runInContext(readFileSync(new URL("../extension/session-request.js", import.meta.url), "utf8"), context);
  const validate = context.validateSessionRequest as (
    r: Record<string, unknown>,
    origin: string,
    allow?: boolean,
  ) => { headers: Record<string, string>; write: boolean };
  const input = {
    url: "https://site.example/api",
    method: "POST",
    headers: { Cookie: "private", Origin: "https://evil.example", Authorization: "explicit-local-test" },
    write: true,
  };
  assert.throws(() => validate(input, "https://site.example"), /allowWrites/);
  assert.throws(() => validate(input, "https://other.example", true), /exact origin/);
  const safe = validate(input, "https://site.example", true);
  assert.equal(safe.headers.cookie, undefined);
  assert.equal(safe.headers.origin, undefined);
  assert.equal(safe.headers.authorization, "explicit-local-test");
  assert.throws(() => validate({ ...input, write: undefined }, "https://site.example", true), /classification/);
  assert.throws(() => validate({ ...input, headers: { x: "bad\r\nheader" } }, "https://site.example", true), /header/);
  assert.equal(
    validate({ ...input, write: false }, "https://site.example", false).write,
    false,
    "known POST read remains a read",
  );
});

test("isolated session fetch sends once with browser cookies and redirect:error, refuses controlled writes", async () => {
  const source = readFileSync(new URL("../extension/session-fetch.js", import.meta.url), "utf8");
  const result = readFileSync(new URL("../extension/session-result.js", import.meta.url), "utf8");
  let sends = 0;
  let pending: unknown;
  let controlled = false;
  const context = createContext({
    browser: {
      storage: {
        local: {
          get: async () => ({ __apiAnythingSessionPending: pending }),
          remove: async () => {
            pending = undefined;
          },
        },
      },
    },
    location: { origin: "http://127.0.0.1" },
    navigator: {
      serviceWorker: {
        get controller() {
          return controlled;
        },
      },
    },
    TextDecoder,
    URL,
    AbortSignal,
    fetch: async (_url: string, init: RequestInit) => {
      sends++;
      assert.equal(init.credentials, "include");
      assert.equal(init.redirect, "error");
      throw Error("connection lost after commit");
    },
  });
  pending = { id: "one", url: op.request.url, method: "POST", headers: {}, write: true };
  runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  const first = runInContext(result, context);
  assert.equal(sends, 1);
  assert.equal(first.id, "one");
  assert.match(first.error, /unknown/);
  assert.equal(pending, undefined);
  controlled = true;
  pending = { id: "two", url: op.request.url, method: "POST", headers: {}, write: true };
  runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(runInContext(result, context).error, /unknown/);
  assert.equal(sends, 1);
});
