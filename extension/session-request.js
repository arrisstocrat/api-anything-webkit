/* global browser, chrome */
// Only validated request data enters private extension storage; never executable code.
globalThis.validateSessionRequest = (input, origin, allowWrites) => {
  if (!input || typeof input.url !== "string" || typeof input.method !== "string") throw new Error("Invalid request");
  const url = new URL(input.url);
  if (!/^https?:$/.test(url.protocol) || url.origin !== origin || url.username || url.password)
    throw new Error("Request must stay on the selected tab's exact origin");
  const method = input.method.toUpperCase();
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)) throw new Error("Unsupported request method");
  if (typeof input.write !== "boolean") throw new Error("Operation read/write classification is required");
  const write = input.write;
  if (write && allowWrites !== true) throw new Error("Explicit allowWrites required");
  const headers = {};
  if (!input.headers || typeof input.headers !== "object" || Array.isArray(input.headers))
    throw new Error("Invalid headers");
  for (const [name, value] of Object.entries(input.headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string" || /[\r\n\0]/.test(value))
      throw new Error("Invalid request header");
    if (
      /^(cookie|cookie2|host|origin|referer|content-length|connection|accept-encoding|user-agent|set-cookie|te|trailer|transfer-encoding|upgrade|via)$/i.test(
        name,
      ) ||
      /^(sec-|proxy-)/i.test(name)
    )
      continue;
    headers[name.toLowerCase()] = value;
  }
  if (input.body !== undefined && (typeof input.body !== "string" || input.body.length > 256_000))
    throw new Error("Invalid body");
  if (/^(GET|HEAD)$/.test(method) && input.body !== undefined) throw new Error("GET/HEAD cannot have a body");
  return {
    url: url.href,
    method,
    headers,
    ...(input.body === undefined ? {} : { body: input.body }),
    write,
  };
};
