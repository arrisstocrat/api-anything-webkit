import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { test } from "node:test";
import { startBridge } from "../src/bridge.js";

test("bridge authenticates clients, isolates web origins and never redelivers a command", async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const config = { port, browserToken: "a".repeat(64), clientToken: "b".repeat(64) };
  const bridge = await startBridge(config);
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, token: string, value?: unknown, extra: Record<string, string> = {}) =>
    fetch(base + path, {
      method: value === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
  try {
    assert.equal((await request("/status", "wrong")).status, 401);
    assert.equal((await request("/status", config.browserToken)).status, 401);
    assert.equal(
      (await request("/status", config.clientToken, undefined, { origin: "https://evil.example" })).status,
      403,
    );
    const id = randomUUID();
    assert.equal(
      (await request("/extension/hello", config.browserToken, { id, name: "Safari", userAgent: "local-test" })).status,
      200,
    );
    const pending = request("/call", config.clientToken, { peer: id, command: { op: "ping" } });
    let task: { id: string; command: { op: string } } | null = null;
    for (let n = 0; !task && n < 30; n++) {
      task = await (await request(`/extension/poll?id=${id}`, config.browserToken)).json();
      if (!task) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(task);
    assert.equal(task.command.op, "ping");
    assert.equal(await (await request(`/extension/poll?id=${id}`, config.browserToken)).json(), null);
    assert.equal(
      (await request(`/extension/result?id=${randomUUID()}`, config.browserToken, { id: task.id, value: "forged" }))
        .status,
      409,
    );
    assert.equal(
      (await request(`/extension/result?id=${id}`, config.browserToken, { id: task.id, value: { engine: "Safari" } }))
        .status,
      200,
    );
    assert.deepEqual(await (await pending).json(), { value: { engine: "Safari" } });
    assert.equal(
      (await request(`/extension/result?id=${id}`, config.browserToken, { id: task.id, value: "duplicate" })).status,
      409,
    );
    const id2 = randomUUID();
    await request("/extension/hello", config.browserToken, { id: id2, name: "Safari", userAgent: "other-test" });
    const ambiguous = await request("/call", config.clientToken, { peer: "safari", command: { op: "ping" } });
    assert.equal(ambiguous.status, 409);
    assert.match(((await ambiguous.json()) as { error: string }).error, /multiple/);
    const result = await (await request("/status", config.clientToken)).json();
    assert.equal(result.length, 2);
    assert.equal(JSON.stringify(result).includes(config.browserToken), false);
    assert.equal(JSON.stringify(result).includes(config.clientToken), false);
  } finally {
    await bridge.close();
  }
});

test("extension reads only a permitted tab and uses host patterns without TCP ports", async () => {
  const { readFileSync } = await import("node:fs");
  const { createContext, runInContext } = await import("node:vm");
  let allowed = true;
  let injected = 0;
  const api = {
    runtime: { onMessage: { addListener() {} } },
    permissions: {
      contains: async (p: { origins: string[] }) => {
        assert.deepEqual([...p.origins], ["http://127.0.0.1/*"]);
        return allowed;
      },
    },
    tabs: {
      get: async () => ({ url: "http://127.0.0.1:18666/" }),
      executeScript: async (_id: number, options: { file: string }) => {
        assert.equal(options.file, "read.js");
        injected++;
        return [{ title: "localhost test" }];
      },
    },
  };
  const context = createContext({
    browser: api,
    API_ANYTHING_CONNECTOR: null,
    setInterval() {},
    setTimeout,
    clearTimeout,
    URL,
  });
  runInContext(
    `${readFileSync(new URL("../extension/background.js", import.meta.url), "utf8")}\nglobalThis.handle = command;`,
    context,
  );
  const handle = context.handle as (c: Record<string, unknown>) => Promise<{ title: string }>;
  assert.equal((await handle({ op: "read", tabId: 1 })).title, "localhost test");
  assert.equal(injected, 1);
  allowed = false;
  await assert.rejects(handle({ op: "read", tabId: 1 }), /Grant access/);
  assert.equal(injected, 1);
  await assert.rejects(handle({ op: "write", tabId: 1 }), /unavailable/);
  assert.equal(injected, 1);
});
