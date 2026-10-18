/** Page-world records are untrusted input. Only bounded read exchanges enter the learner. */
import { z } from "zod";
import type { CaptureResult } from "./types.js";

const httpUrl = z.url().refine((value) => /^https?:\/\//.test(value), "HTTP(S) URL required");
const headers = z.record(z.string().max(256), z.string().max(16_384));
const ReadCapture = z.object({
  finalUrl: httpUrl,
  cookies: z.array(z.never()).max(0),
  exchanges: z
    .array(
      z.object({
        id: z.number().int().positive(),
        resourceType: z.literal("fetch"),
        request: z.object({ method: z.enum(["GET", "HEAD"]), url: httpUrl, headers }),
        response: z.object({
          status: z.number().int().min(100).max(599),
          headers,
          contentType: z.string().max(1024),
          body: z.string().max(256_000),
        }),
      }),
    )
    .max(40),
});
export function parseReadCapture(value: unknown): CaptureResult {
  if (JSON.stringify(value)?.length > 1_100_000) throw new Error("read capture exceeds size limit");
  const parsed = ReadCapture.parse(value);
  const ids = parsed.exchanges.map((e) => e.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate captured request ids");
  return parsed;
}
