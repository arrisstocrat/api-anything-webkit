/** Explicit installed-browser transport. One dispatch; no healing, retries, or redirects. */
import { z } from "zod";
import { bridgeCall } from "./bridge.js";
import { judge } from "./classify.js";
import type { CallResult } from "./execute.js";
import { capOutput } from "./extract.js";
import { buildRequest } from "./http.js";
import type { Session } from "./session.js";
import type { Operation } from "./spec.js";

export interface BrowserTarget {
  peer: string;
  tabId: number;
}
const Reply = z.object({
  status: z.number().int().min(100).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.string().max(1_000_000),
  url: z.url(),
});
export async function callInBrowser(
  op: Operation,
  args: Record<string, unknown>,
  session: Session,
  target: BrowserTarget,
  allowWrites = false,
  dispatch = bridgeCall,
): Promise<Omit<CallResult, "ms">> {
  const write = !op.readOnly;
  if (write && !allowWrites) return { ok: false, class: "refused", reason: "Explicit allowWrites required" };
  if (!target.peer || !Number.isSafeInteger(target.tabId) || target.tabId < 0)
    return { ok: false, class: "input", reason: "An exact browser and tab id are required" };
  if (op.minTier > 2)
    return {
      ok: false,
      class: "blocked",
      reason: "This operation requires a guarded UI trigger; session fetch cannot execute it",
    };
  let request: ReturnType<typeof buildRequest>;
  try {
    request = buildRequest(op, args, session);
  } catch {
    return { ok: false, class: "input", reason: "Request could not be built; check parameters and session refs" };
  }
  try {
    const response = Reply.parse(
      await dispatch(target.peer, {
        op: "session-fetch",
        tabId: target.tabId,
        request: { ...request, write },
        allowWrites,
      }),
    );
    if (new URL(response.url).origin !== new URL(request.url).origin) throw new Error("Unexpected response origin");
    const result = judge(op, response);
    return {
      ok: result.class === "ok",
      class: result.class,
      tier: 2,
      ...(result.class === "ok" ? capOutput(result.data) : { reason: result.reason }),
      ...(!write || result.class === "ok"
        ? {}
        : { next: "Request was dispatched once. Check the site before any retry; no healing or retry was attempted." }),
    };
  } catch {
    // Browser exceptions may quote credentials. Report a fixed message instead.
    return {
      ok: false,
      class: "error",
      tier: 2,
      reason: write
        ? "Browser write outcome is unknown; it was not retried or redirected"
        : "Browser request failed; check the connection, tab origin, site permission and sign-in",
      next: write
        ? "Check the site before any retry. A timeout, redirect, or browser error may occur after the write commits."
        : "Check bridge status and the selected tab; no automatic retry was attempted",
    };
  }
}
