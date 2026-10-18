# Installed-browser network investigation

The installed-browser connector is verified for tab operations and permitted DOM
reads. Version 0.1.0-webkit.3 additionally verifies bounded page-level read capture
and two-example learning in both browsers; this does not establish guarded writes.

The next implementation path was checked against current WebExtensions API data:

- Safari exposes `devtools.inspectedWindow` and resource inspection, but its
  `devtools.network.onRequestFinished` and `devtools.network.getHAR` are listed as
  unsupported. A network namespace existing is not proof that request bodies,
  response bodies and wire headers are available.
- Safari's `webRequest.BlockingResponse` is listed as unsupported. Declarative
  content blocking is a different interface; it does not supply an arbitrary
  asynchronous API Anything guard or complete response-body capture.
- Orion implements Chrome/Firefox extensions with partial API compatibility.
  It needs its own network and guard tests; successful tab operations cannot
  substitute for those tests.

Sources checked during implementation:
[MDN compatibility data, devtools](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/devtools.json),
[MDN compatibility data, webRequest](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/webRequest.json),
[Apple declarative blocking](https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension),
[Orion API compatibility](https://help.kagi.com/orion/misc/technical.html).

The connector now implements a page-level fetch/XHR observer for read learning
([workflow](BROWSER-CONNECTOR.md)). It observes a subset of traffic, and misses
requests sent before injection, workers, other frames, native redirects and unload
traffic. It must not be treated as a complete guard, nor may DOM snapshots be
presented as original HTTP exchanges.

A custom rebuilt Playwright WebKit would be another browser binary. It would not
patch the installed, signed Safari application or every third-party WebKit browser.
Installing Xcode alone cannot supply the missing public browser interfaces.

Full installed-browser parity remains unresolved. Do not remove the published
limitations until an actual per-browser implementation passes the original guard
and learning tests against real traffic.


Version 0.1.0-webkit.4 adds isolated same-origin session calls for known templates.
They dispatch once, use browser-managed cookies and redirect:error, and skip
healing/retries. They do not provide guarded UI learning. Current official
[MDN DNR compatibility data](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/declarativeNetRequest.json)
lists Safari updateSessionRules from 15.4, requestMethods from 26, but tabIds as
unsupported. Therefore a tab-scoped blanket guard cannot be inferred from DNR
presence. No broad browser-wide block or extra host permission was installed.

### Attempts to remove Chromium from write learning

On macOS 27.0.1 with the installed Playwright WebKit revision 2359, two candidate
isolation paths were tested against disposable localhost endpoints:

- Creating the context offline also prevented the intercepted/fulfilled bootstrap
  document from loading (`WebKit encountered an internal error`). It did not give
  a usable page for training UI actions.
- Launching the WebKit entry point under sandbox-exec with `(deny network-outbound)`
  did not isolate its networking service: the server observed one HTTP POST and
  one WebSocket upgrade attempt. A socket error in the page was not evidence of
  zero network traffic. The system-launched networking service was not constrained
  by the expected parent-process restriction.

The latter check is reproducible with
`node examples/probe-webkit-network-isolation.mjs`. Exit 2 and
`networkIsolation:false` are the expected diagnostic failure on the tested setup;
this is not part of the passing regression suite. It never modifies Safari/Orion,
Wi-Fi settings or system firewall rules. No such launcher is installed or used by
the production runtime. These failures do not prove a future WebKit-only guard is
impossible; they rule out these two approaches on this setup. Guarded write
learning remains disabled rather than using a bypassable network restriction.
