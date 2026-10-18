/** Local transport for browsers that expose WebExtensions instead of Playwright. */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { home, writePrivate } from "./session.js";

const Config = z.object({
  port: z.number().int().min(1024).max(65535),
  browserToken: z.string().length(64),
  clientToken: z.string().length(64),
});
export function bridgeConfig() {
  const file = join(home(), "bridge.json");
  if (existsSync(file)) return Config.parse(JSON.parse(readFileSync(file, "utf8")));
  const config = {
    port: 18665,
    browserToken: randomBytes(32).toString("hex"),
    clientToken: randomBytes(32).toString("hex"),
  };
  writePrivate(file, JSON.stringify(config));
  return config;
}
export function prepareConnector(dir: string): string {
  const config = bridgeConfig();
  const target = resolve(dir);
  if (existsSync(target)) throw new Error("connector destination already exists; choose a new directory");
  cpSync(fileURLToPath(new URL("../extension", import.meta.url)), target, { recursive: true });
  writePrivate(
    join(target, "config.js"),
    `globalThis.API_ANYTHING_CONNECTOR = ${JSON.stringify({ port: config.port, token: config.browserToken, autoConnect: true })};\n`,
  );
  return target;
}
const Handshake = z.object({ id: z.string().uuid(), name: z.string().min(1).max(80), userAgent: z.string().max(1024) });
interface Peer {
  id: string;
  name: string;
  userAgent: string;
  seen: number;
}
interface Task {
  id: string;
  peer: string;
  command: Record<string, unknown>;
  delivered: boolean;
  timer: NodeJS.Timeout;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error("bridge message exceeds 4 MiB");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function authorized(req: IncomingMessage, token: string): boolean {
  const got = Buffer.from(req.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
export async function startBridge(config = bridgeConfig()) {
  const peers = new Map<string, Peer>();
  const tasks = new Map<string, Task>();
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(value));
    };
    // Reject DNS rebinding and web-page requests, even when a page can reach localhost.
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (
      host !== `127.0.0.1:${config.port}` ||
      (origin && !/^(?:safari-web-extension|moz-extension|chrome-extension):\/\/[^/]+$/.test(origin))
    )
      return send(403, { error: "bridge origin rejected" });
    if (origin) res.setHeader("access-control-allow-origin", origin);
    if (req.method === "OPTIONS") {
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-allow-methods", "GET, POST");
      return send(200, {});
    }
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.port}`);
      const extension = url.pathname.startsWith("/extension/");
      if (!authorized(req, extension ? config.browserToken : config.clientToken))
        return send(401, { error: "bridge authentication required" });
      if (req.method === "POST" && url.pathname === "/extension/hello") {
        const peer = Handshake.parse(await body(req));
        peers.set(peer.id, { ...peer, seen: Date.now() });
        return send(200, { ok: true });
      }
      const id = url.searchParams.get("id") ?? "";
      if (req.method === "GET" && url.pathname === "/extension/poll") {
        const peer = peers.get(id);
        if (!peer) return send(409, { error: "reconnect required" });
        peer.seen = Date.now();
        const task = [...tasks.values()].find((t) => t.peer === id && !t.delivered);
        if (task) task.delivered = true; // Never redeliver a request: it may already have run.
        return send(200, task ? { id: task.id, command: task.command } : null);
      }
      if (req.method === "POST" && url.pathname === "/extension/result") {
        const result = z
          .object({ id: z.string().uuid(), value: z.unknown().optional(), error: z.string().optional() })
          .parse(await body(req));
        const task = tasks.get(result.id);
        if (!task || task.peer !== id || !task.delivered) return send(409, { error: "unknown task" });
        tasks.delete(task.id);
        clearTimeout(task.timer);
        if (result.error) task.reject(new Error(result.error));
        else task.resolve(result.value);
        return send(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/status")
        return send(
          200,
          [...peers.values()].filter((p) => Date.now() - p.seen < 5000),
        );
      if (req.method === "POST" && url.pathname === "/call") {
        const call = z
          .object({ peer: z.string().min(1), command: z.record(z.string(), z.unknown()) })
          .parse(await body(req));
        const active = [...peers.values()].filter(
          (p) => Date.now() - p.seen < 5000 && (p.id === call.peer || p.name.toLowerCase() === call.peer.toLowerCase()),
        );
        if (active.length !== 1)
          return send(409, {
            error: active.length ? "multiple browsers match; use the exact connection id" : "browser is not connected",
          });
        const value = await new Promise((resolve, reject) => {
          const taskId = randomUUID();
          const timer = setTimeout(() => {
            tasks.delete(taskId);
            reject(new Error("browser request timed out; it has not been retried"));
          }, 30_000);
          tasks.set(taskId, {
            id: taskId,
            peer: active[0].id,
            command: call.command,
            delivered: false,
            timer,
            resolve,
            reject,
          });
        });
        return send(200, { value });
      }
      send(404, { error: "unknown bridge route" });
    } catch (e) {
      send(400, { error: (e as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  return {
    server,
    close: async () => {
      for (const task of tasks.values()) {
        clearTimeout(task.timer);
        task.reject(new Error("bridge closed; request not retried"));
      }
      tasks.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
export async function bridgeStatus(): Promise<unknown> {
  const c = bridgeConfig();
  const response = await fetch(`http://127.0.0.1:${c.port}/status`, {
    headers: { authorization: `Bearer ${c.clientToken}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error("local bridge is unavailable");
  return response.json();
}
export async function bridgeCall(peer: string, command: Record<string, unknown>): Promise<unknown> {
  const c = bridgeConfig();
  const response = await fetch(`http://127.0.0.1:${c.port}/call`, {
    method: "POST",
    headers: { authorization: `Bearer ${c.clientToken}`, "content-type": "application/json" },
    body: JSON.stringify({ peer, command }),
    signal: AbortSignal.timeout(32_000),
  });
  const result = (await response.json()) as { value?: unknown; error?: string };
  if (!response.ok || result.error) throw new Error(result.error ?? "browser connector failed");
  return result.value;
}
