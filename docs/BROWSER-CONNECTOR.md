# Installed-browser connector (experimental)

The `bridge` transport connects API Anything to installed browsers through a shared
WebExtension. It is independent of the Playwright backend. It uses the actual
browser's existing windows and tabs.

**Current scope:** tab operations, permitted DOM reads, and read learning from
GET/HEAD fetch/XHR issued by the top frame after capture starts. Captures are real
page-visible requests/responses, not DOM snapshots. Two examples feed the existing
learner; learned operations can then replay using direct HTTP. Explicit browser-session replay of known operations is available (see below).
Automatic browser healing, guarded UI triggers and learning new writes remain unavailable.
Cookies, implicit browser headers and browser storage are not exported. Session
fetch uses the selected tab's own cookies; CSRF/header refs still need valid values.

## Compatibility and evidence

| Browser | Evidence |
| --- | --- |
| Safari 27.0.1 on macOS 27.0.1 | Extension 0.1.6: read learning, HttpOnly session call, page-fetch isolation and single-dispatch write cases verified |
| Orion 1.1.3 on macOS 27.0.1 | Extension 0.1.6: read learning, HttpOnly session call, page-fetch isolation and single-dispatch write cases verified |
| Other WebKit browsers | Require compatible WebExtensions APIs and testing; not verified |
| Browsers without a compatible extension or automation interface | No connector available |

WebKit alone does not define a common connection protocol. Do not claim support
for every browser using the engine. The desktop manifest currently uses a
persistent Manifest V2 background page; mobile and browsers rejecting Manifest V2
need a different background implementation.

## Prepare and install

```sh
api-anything bridge prepare /absolute/path/to/new-private-connector
api-anything bridge serve
```

The destination must not exist. It contains a unique local pairing token and
must stay private. **Never commit, upload or share this prepared directory or a
ZIP made from it.** Share the repository's `extension/` template instead; its
configuration has no token, and each user prepares their own installation.

Load the prepared extension into each browser you want to connect:

- Safari: Settings → Advanced → Show features for web developers; Developer →
  Add Temporary Extension. macOS may require your password to enable local
  extensions. Temporary installations are for development, not a signed App
  Store release.
- Orion: Tools → Extensions → Install from Disk. For a ZIP installation, Orion
  unpacks a copy; Reload from Disk reloads that installed copy rather than a
  subsequently edited source ZIP. Reinstall the updated package when upgrading.

The prepared copy connects automatically on first load. Its popup lets you name
or disconnect the browser and grant access to a specific site's host. Safari
also shows its own access prompts. No website cookies are imported or exported
by this connector. Access is not requested for every site at once.

```sh
api-anything bridge status
api-anything bridge ping Safari
api-anything bridge tabs Orion
api-anything bridge open Orion https://example.com/
api-anything bridge read Orion 123   # use an id from tabs, after granting this site
```

`status` shows each connection's unique id. Use that id instead of a name if
several browsers have the same name; ambiguous names are refused. Do not share
`tabs` output if it contains private addresses. `read` returns rendered HTML,
limited to two million characters with a `truncated` flag.

## Local service and security

The server binds only `127.0.0.1:18665`. CLI and browser use separate random
tokens in `~/.api-anything/bridge.json` (mode 0600). Requests from ordinary web
origins and non-loopback Host values are rejected. The pairing token is available
only to extension code in the private installation copy, not to site scripts.
Commands are delivered at most once; after a disconnect or timeout their outcome
can be unknown, and the transport never automatically retries them.

A per-site permission is a browser host permission, which applies to that host
across its ports. The bridge itself has no unauthenticated browser-control route.
`serve` runs in the foreground; stopping it disconnects every browser. A local
installation may separately start it as a user service. Source tests use localhost
and mock peers; actual browser checks are required in addition.

## This Mac's managed service

The local installation uses the per-user LaunchAgent
`com.arrisstocrat.api-anything.bridge`, with the installed Node executable and
`api-anything bridge serve`. It starts at login and reconnects the prepared
extensions. It remains bound to loopback and uses the same private tokens.
Stop it with `launchctl bootout gui/$(id -u)/com.arrisstocrat.api-anything.bridge`.
The separate localhost page used for browser validation is a test fixture, not
part of the service. Other users can run `bridge serve` directly; no service is
installed merely by downloading this repository.

## Next-stage network support

The [installed-browser network investigation](INSTALLED-BROWSER-NETWORK.md) records
the limits of page-level network capture and why guarded writes are not included. Installing developer
tools or rebuilding a separate WebKit does not modify installed Safari/Orion APIs.

## Teach a read operation in Safari or Orion

Use an exact tab id and grant that host in the popup. Start on the site's already
loaded page. Capture expires after five minutes; navigating the document ends it.
Perform only the desired read/search in this tab after starting:

```sh
api-anything bridge capture-start Safari 123
# Perform a read with input alpha in the selected tab.
api-anything bridge capture-status Safari 123
api-anything bridge capture-stop Safari 123
# Keep the returned capture id as FIRST.
api-anything bridge capture-start Safari 123
# Perform the same read with input bravo.
api-anything bridge capture-stop Safari 123
# Keep the returned capture id as SECOND.
api-anything add my-site search --from FIRST --from2 SECOND --example q=alpha --example2 q=bravo --extract items
api-anything call my-site search q=charlie
```

Replace the input name and extraction path with those of the captured request.
`inspect FIRST --outline --example q=alpha` helps choose the request/recipe.
There is no automatic UI trigger recording; a missing trigger parameter warning
means automatic recapture/healing is unavailable for that operation.

The observer uses a packaged page script. A site's CSP can block it; start then
fails explicitly. Requests before injection, saved original fetch references,
workers, frames, document loads, streams over 256 KB, binary/opaque responses and
intermediate redirect hops are outside coverage. Maximum 40 exchanges and about
1 MB total are kept. Stop waits briefly for outstanding fetches, not unfinished
XHRs; wait for the visible search result before stopping.
The wrapper observes only GET/HEAD and does not prevent any request. Method alone
does not prove absence of side effects: **never use this as write protection**.
The page can interfere with the hook or forge records. They are untrusted data,
validated on import; the page never receives the bridge pairing token.
Captures are private (0600), pruned by the existing capture retention policy.

Validation on this Mac: Safari examples alpha/bravo returned charlie; Orion
examples alpha/bravo returned delta, both with `class: ok`, `tier: 1`. This proves
the local read-learning path, not compatibility with every site's authentication.

Reproduce the local browser test with `node examples/bridge-read-fixture.mjs`, open
`http://127.0.0.1:18667/` in each browser and use the capture workflow above. The
page has fetch and XHR search buttons with a `q` input; its response recipe is
`--extract items`. Stop the fixture with Ctrl+C. It stores no account data.

## Call using the current sign-in

```sh
api-anything call my-site search q=charlie --browser Safari --tab 123
# Only for the exact write the user requested, with an already learned write spec:
api-anything call my-site saved-write text=example --browser Orion --tab 456 --allow-writes
# Preview the stored template with credentials redacted, without sending:
api-anything call my-site saved-write text=example --dry
```

The URL must have the selected tab's exact origin, including port. Grant that host
in the popup. A new tab is allowed to finish loading before dispatch. Requests run
in the isolated extension context, not a page-controlled fetch wrapper. Both real
browsers passed a test with the page's fetch deliberately replaced by a throwing
function. HttpOnly/SameSite=Strict session reads passed; plain Node without the
browser session got 401. No new cookie-reading permission was added.

The normal operation read/write classification is authoritative (a GraphQL POST
can be a read; a GET can be a write). Writes require --allow-writes in CLI/library;
MCP additionally must be started with --allow-writes. MCP call_operation accepts
`browser: {peer: "Safari", tabId: 123}` after restarting its server to load this
version. Each call dispatches once; no tier fallback, re-import, healing or retry
runs in this mode. `--max-tier 1` forbids it. Tier-3-only operations are refused.

`redirect:error` refuses every redirect, including same-origin. The initial write
may already have committed. Timeouts, disconnects, response-limit errors and lost
contexts likewise have unknown outcomes: **check the site before another call**.
A service-worker-controlled page refuses writes. This is a narrow known-request
transport, not a guard around arbitrary UI activity or background workers. Exact
once server execution still requires the site's own idempotency support.

Cookies stay in the browser. An explicit request payload passes briefly through
private extension storage and is removed after consumption and on completion;
page scripts never receive the bridge key or this payload. Response limit 1 MB,
fetch deadline 15 seconds. Ordinary browser header and CORS restrictions apply.
No cross-origin request or redirect is used to work around them. A fresh site
capture may be required when CSRF/header refs expire.

Reproduce the authenticated test with `node examples/bridge-session-fixture.mjs`,
open `http://127.0.0.1:18668/` in each browser, and click Sign in locally. This
creates only a disposable localhost session. Two private-search captures train
`q`; call it with an unseen value and --browser/--tab. The server's /stats reports
write counts for tests. Actual checks: each normal POST incremented once; each
307 initial POST incremented once and redirectTargets stayed zero; each committed
POST with a disconnected response incremented disconnectedWrites once. Both
browsers refused missing write authorization without changing counts.

Guarded learning of new writes through these browsers is still unavailable. Learn
such an operation with the existing Chromium guard, then explicitly call its
stored template through Safari/Orion. Never mark an unguarded capture as a guarded
write capture. Native Safari DNR tabIds are unsupported in the checked API data;
page-level wrappers cannot cover all workers, frames and existing sockets. See
[network investigation](INSTALLED-BROWSER-NETWORK.md).
