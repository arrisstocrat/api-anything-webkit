# Installed-browser connector (experimental)

The `bridge` transport connects API Anything to installed browsers through a shared
WebExtension. It is independent of the Playwright backend. It uses the actual
browser's existing windows and tabs.

**Current scope:** tab operations, permitted DOM reads, and read learning from
GET/HEAD fetch/XHR issued by the top frame after capture starts. Captures are real
page-visible requests/responses, not DOM snapshots. Two examples feed the existing
learner; learned operations can then replay using direct HTTP. Browser-session replay,
automatic browser healing, guarded triggers and writes remain unavailable.
Cookies, implicit browser headers and browser storage are not exported, so private
operations needing them cannot yet replay with this transport alone.

## Compatibility and evidence

| Browser | Evidence |
| --- | --- |
| Safari 27.0.1 on macOS 27.0.1 | Extension 0.1.4: localhost fetch and XHR captured, two examples learned, unseen value replayed over HTTP (tier 1) |
| Orion 1.1.3 on macOS 27.0.1 | Extension 0.1.4: localhost XHR and fetch captured, two examples learned, unseen value replayed over HTTP (tier 1) |
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
