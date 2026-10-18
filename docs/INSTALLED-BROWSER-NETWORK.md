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
