(() => {
  const MARKER = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;

  if (isAnalyzer) {
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "POCKET_ANALYZER_QUOTE") {
        window.postMessage({ source: MARKER, kind: "quote", quote: message.quote }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_HISTORY") {
        window.postMessage({ source: MARKER, kind: "history", history: message.history }, "*");
      }
    });

    window.addEventListener("message", event => {
      if (event.source !== window || event.data?.source !== MARKER) return;
      if (event.data.kind === "history-request") {
        chrome.runtime.sendMessage({
          type: "POCKET_ANALYZER_HISTORY_REQUEST",
          request: {
            symbol: event.data.symbol,
            period: event.data.period,
            count: event.data.count,
            stamp: event.data.stamp
          }
        }).catch(() => {});
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

    if (event.data.kind === "history" && event.data.history) {
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_HISTORY",
        history: event.data.history
      }).catch(() => {});
    }

    if (event.data.kind === "history-request-to-page" && event.data.request) {
      window.postMessage({
        source: MARKER,
        kind: "history-request",
        request: event.data.request
      }, "*");
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST_TO_PAGE") {
      window.postMessage({
        source: MARKER,
        kind: "history-request",
        request: message.request
      }, "*");
    }
  });
})();