# Installed-browser connector (experimental)

The `bridge` transport connects API Anything to installed browsers through a shared
WebExtension. It is independent of the Playwright backend. It uses the actual
browser's existing windows and tabs.

**Current scope:** connection checks, listing tabs, opening a new HTTP(S) tab, and
reading the DOM of an explicitly permitted tab. This is a connector foundation,
not full API Anything integration: capture/learning, browser request replay,
healing, guarded triggers and writes are not implemented through this transport.
The existing Chromium and opt-in Playwright WebKit backends keep their own scope.
A DOM read is not a captured HTTP response; it is not submitted to the learner as one.

## Compatibility and evidence

| Browser | Evidence |
| --- | --- |
| Safari 27.0.1 on macOS 27.0.1 | Extension 0.1.3 installed; actual connection, tab listing and localhost DOM read verified |
| Orion 1.1.3 on macOS 27.0.1 | Extension 0.1.3 installed; actual connection, tab listing, opening a localhost tab and DOM read verified |
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
