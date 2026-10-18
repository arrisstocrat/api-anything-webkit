# WebKit interception investigation

Status: unresolved; the published backend continues to reject guarded trigger runs.

## Reproduce without API Anything

```sh
npm ci
node node_modules/playwright-core/cli.js install webkit
node examples/probe-webkit-redirects.mjs
```

This script starts a read-only localhost server. A stylesheet redirects to another
stylesheet, whose URL the route handler is supposed to abort. No account, real
website, write operation or credential is involved. On the affected build the
script deliberately exits with an assertion failure, printing:

```json
{
  "engine": "26.6",
  "intercepted": ["/", "/redirect.css"],
  "protectedEndpointHits": 1
}
```

A passing result requires `protectedEndpointHits: 0`. This is a diagnostic probe,
not part of the normal test suite. A passing result alone does not establish full
write safety: popups, teardown traffic, workers, WebSockets and concurrent runs
also need their own guards and end-to-end validation.

To probe a custom **Playwright-compatible** WebKit binary, set
`WEBKIT_EXECUTABLE` to its launcher path. This does not make Safari or Orion
compatible with Playwright.

## What has been checked

- The installed, pinned Playwright 1.63.0 / WebKit 26.6 build misses the redirect
  hop in ordinary request routes. An independent probe with Playwright 1.64.1 /
  WebKit 27.2 showed the same missing redirect interception.
- Native request interception covers more traffic than public routes, but does
  not supply a paused request for this redirect hop either.
- A loopback forward proxy could reject a simple redirect before forwarding it,
  but multi-origin localhost tests also showed requests bypassing the configured
  proxy. That experiment was rejected; the proxy is not part of this backend.
- Removing header overrides did not make the proxy experiment reliable.

## Engine investigation

The Playwright 1.63.0 WebKit build starts from WebKit revision
`4d05d732e5a84f32675bef4cc135a2e7a9269a87` plus Playwright's patches.
The initial request path in `WebLoaderStrategy::scheduleLoad` calls
`InspectorInstrumentationWebKit::interceptRequest`. In contrast, the redirect
path in `WebResourceLoader::willSendRequest` resumes the network load after
`ResourceLoader::willSendRequest` without an equivalent interception step.
Playwright's `WKPage::_onRequestWillBeSent` also explicitly handles redirect
notifications without waiting for `requestIntercepted`.

This identifies a candidate area to change, not a verified engine fix. A complete
fix needs a rebuilt engine, compatible Playwright handling, cancellation/lifetime
checks and the full guard tests. The local Mac has Command Line Tools but no full
Xcode installation, so a custom macOS WebKit build has not been compiled or tested.
See [WebKit build requirements](https://webkit.org/build-tools/) and the
[Playwright WebKit build configuration](https://github.com/microsoft/playwright/blob/v1.63.0/browser_patches/webkit/UPSTREAM_CONFIG.sh).

Do not enable guarded WebKit runs by deleting the refusal in `runTrigger`.
