(() => {
  const MARKER = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;

  if (isAnalyzer) {
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "POCKET_ANALYZER_QUOTE") {
        window.postMessage({
          source: MARKER,
          kind: "quote",
          quote: message.quote
        }, "*");
      }
    });
    return;
  }

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== MARKER) return;
    if (event.data.kind === "quote" && Array.isArray(event.data.quote)) {
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_QUOTE",
        quote: event.data.quote
      }).catch(() => {});
    }
  });
})();