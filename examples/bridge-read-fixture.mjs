import { createServer } from "node:http";

const html = `<!doctype html><meta charset="utf-8"><title>API Anything read learning test</title><h1>Read learning</h1><label>Query <input id="q" value="alpha"></label><button id="fetch">Fetch search</button><button id="xhr">XHR search</button><pre id="result"></pre><script>
const q=document.querySelector('#q'),out=document.querySelector('#result');
document.querySelector('#fetch').onclick=async()=>{out.textContent=await(await fetch('/api/search?q='+encodeURIComponent(q.value))).text()};
document.querySelector('#xhr').onclick=()=>{const x=new XMLHttpRequest();x.open('GET','/api/search?q='+encodeURIComponent(q.value));x.onload=()=>out.textContent=x.responseText;x.send()};
</script>`;
createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1:18667");
  if (u.pathname === "/api/search") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ items: [{ query: u.searchParams.get("q"), label: "Result for " + u.searchParams.get("q") }] }),
    );
  } else {
    res.setHeader("content-type", "text/html");
    res.end(html);
  }
}).listen(18667, "127.0.0.1", () => console.log("Read-only fixture on 127.0.0.1:18667"));
