// Disposable localhost fixture. No real account credentials or external requests.
import { createServer } from "node:http";

const state = { writes: 0, redirectTargets: 0, disconnectedWrites: 0 };
const html = `<!doctype html><meta charset="utf-8"><title>API Anything session test</title>
<h1>Session test</h1><p>Disposable localhost account</p><a href="/sign-in">Sign in locally</a>
<label>Query <input id="q" value="alpha"></label><button id="search">Private search</button>
<button id="tamper">Replace page fetch (isolation test)</button><pre id="result"></pre>
<script>
const q=document.querySelector('#q'),out=document.querySelector('#result');
document.querySelector('#search').onclick=async()=>out.textContent=await(await fetch('/private/search?q='+encodeURIComponent(q.value))).text();
document.querySelector('#tamper').onclick=()=>{window.fetch=()=>{throw new Error('page fetch replaced')};out.textContent='Page fetch replaced'};
</script>`;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:18668");
  const json = (value, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === "/sign-in") {
    res.writeHead(302, {
      "set-cookie": "aa_fixture_session=local-test-only; HttpOnly; SameSite=Strict; Path=/",
      location: "/",
    });
    res.end();
    return;
  }
  if (url.pathname === "/stats") return json(state);
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    res.end(html);
    return;
  }
  if (!req.headers.cookie?.includes("aa_fixture_session=local-test-only"))
    return json({ error: "sign in required" }, 401);
  if (url.pathname === "/private/search")
    return json({ items: [{ query: url.searchParams.get("q"), signedIn: true }] });
  if (url.pathname === "/write" && req.method === "POST") {
    state.writes++;
    return json({ query: url.searchParams.get("q"), writes: state.writes });
  }
  if (url.pathname === "/write-redirect" && req.method === "POST") {
    state.writes++;
    res.writeHead(307, { location: "/write-target" });
    res.end();
    return;
  }
  if (url.pathname === "/write-target") {
    state.redirectTargets++;
    return json({ repeated: true });
  }
  if (url.pathname === "/write-disconnect" && req.method === "POST") {
    state.disconnectedWrites++;
    req.socket.destroy();
    return;
  }
  return json({ error: "not found" }, 404);
});
server.listen(18668, "127.0.0.1", () => console.log("Session fixture on 127.0.0.1:18668"));
