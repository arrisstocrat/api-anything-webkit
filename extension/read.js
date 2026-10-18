// A packaged script avoids evaluating code received over the bridge.
(() => {
  const html = document.documentElement.outerHTML;
  return {
    url: location.href,
    title: document.title,
    html: html.slice(0, 2_000_000),
    truncated: html.length > 2_000_000,
  };
})();
