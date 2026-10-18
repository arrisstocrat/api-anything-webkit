# WebKit backend (local fork)

This fork adds an opt-in WebKit backend. The default installed-Chromium selection is unchanged.
It uses **Playwright's patched WebKit**, not Orion or Safari. Those browsers do not implement
the automation protocol Playwright requires; setting their executable path does not add it.
Orion's tabs, passwords, cookies and browsing profile are not accessed or imported.

## Install and select

After installing this fork, download the WebKit build matching its Playwright dependency:

The fork pins `playwright-core` to the tested version so a global package installation uses
the same browser revision as a development checkout.

```sh
node "$(npm root -g)/api-anything/node_modules/playwright-core/cli.js" install webkit
API_ANYTHING_BROWSER=webkit api-anything capture 'https://example.com'
```

Set `API_ANYTHING_BROWSER=webkit` in the environment of each CLI or MCP process that should
use it. `playwright-webkit` is an alias. A missing WebKit build is reported as unavailable;
the runtime does not silently use Chromium instead. To switch back, unset the variable or
select a Chromium executable explicitly.

For Codex (use an absolute command path if your desktop app needs it):

```sh
codex mcp add api-anything --env API_ANYTHING_BROWSER=webkit -- api-anything mcp
```

Restart the agent session after changing its MCP configuration. CLI commands launched by the
agent must also receive the environment variable; the installed skill documents this.

## Supported scope

| Feature | WebKit |
| --- | --- |
| Plain HTTP operations (tier 1) | Supported; no browser needed |
| Capture and learn read operations (`capture`, `add` without `--write`) | Supported |
| In-page navigation and UI steps during read learning | Supported |
| Page fetches (tier 2), including caller-controlled redirects | Supported |
| Visible window for manual login | Supported; its own WebKit profile |
| Cookies, local storage and IndexedDB across managed restarts | Saved in a private storage-state file |
| Guarded trigger runs, including tier 3 and trigger-based healing | Refused before opening a page |
| Learning writes (`--write`) | Refused before opening a page |
| Driving an installed Orion or Safari | Unsupported |

The Chromium guard watches redirect hops and unload traffic through CDP. Playwright's portable
routes do not provide equivalent coverage, and CDP is available only on Chromium. WebKit therefore
rejects **any** `runTrigger` call with an interceptor, even for a read. This includes guarded tier-3
fallbacks and trigger recaptures. It never removes a guard just to make a call succeed. Use Chromium
when these capabilities are required. This is an initial WebKit backend, not full Chromium parity.

WebKit uses `<profileDir>-webkit` (normally `~/.api-anything/profile-webkit`) and a separate
`webkit-ua.json` cache. Chromium keeps its existing directory and UA cache. WebKit session cookies
are not kept by its native persistent context, so managed closure writes cookies and origin storage
to `api-anything-state.json` with mode `0600`; the next launch restores that state. An externally
killed browser may lose changes since the last snapshot. During visible login, state is sampled once
per second to cover the user closing the window.
An exclusive profile lock prevents concurrent CLI and MCP processes from overwriting that state;
a second process waits up to 15 seconds. A lock left by a process that exited is reclaimed.

## Local verification

```sh
npm run check
npm run lint
node --import tsx --test test/webkit.test.ts test/browser-choice.test.ts
```

WebKit integration tests use localhost only and skip if the matching WebKit binary is absent.
They exercise actual browser traffic, learning and unseen-input replay, POST capture, navigation,
cookie/storage persistence, headed startup, redirects and refusal of guarded runs. The engine-switch
test also uses the bundled Chromium binary when installed. The existing suite remains a Chromium
suite; set `API_ANYTHING_BROWSER` to a working Chromium executable before running `npm test`.

## Redirect interception investigation

A standalone, localhost-only reproduction and the attempted fixes are documented in
[WebKit interception investigation](WEBKIT-INTERCEPTION.md). The redirect issue is unresolved;
the published backend keeps guarded runs disabled.

## Installed Safari and Orion

A separate [experimental connector](BROWSER-CONNECTOR.md) supports connection checks,
tab listing, opening pages and permitted DOM reads in the installed browsers. It is
independent of this Playwright backend and does not yet supply capture/learning or replay.
