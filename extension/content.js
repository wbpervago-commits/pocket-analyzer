(() => {
  const MARKER = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;

  if (isAnalyzer) {
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "POCKET_ANALYZER_QUOTE" && Array.isArray(message.quote)) {
        window.postMessage({ source: MARKER, kind: "quote", quote: message.quote }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_HISTORY" && message.history) {
        window.postMessage({ source: MARKER, kind: "history", history: message.history }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_BRIDGE_STATUS") {
        window.postMessage({ source: MARKER, kind: "bridge-status", status: message.status }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
        window.postMessage({ source: MARKER, kind: "history-status", status: message.status }, "*");
      }
    });

    window.addEventListener("message", event => {
      if (event.source !== window || event.data?.source !== MARKER) return;
      if (event.data.kind === "extension-ping") {
        window.postMessage({ source: MARKER, kind: "bridge-status", status: "analyzer-extension-ready" }, "*");
      }
      if (event.data.kind === "history-request") {
        const { symbol, period, count } = event.data;
        chrome.runtime.sendMessage({
          type: "POCKET_ANALYZER_HISTORY_REQUEST", symbol, period, count
        }).catch(() => {});
      }
    });
    return;
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST") {
      window.postMessage({
        source: MARKER, kind: "history-request",
        symbol: message.symbol, period: message.period, count: message.count
      }, "*");
    }
  });

  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== MARKER) return;
    if (event.data.kind === "bridge-status") {
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_BRIDGE_STATUS", status: event.data.status
      }).catch(() => {});
    }
    if (event.data.kind === "quote" && Array.isArray(event.data.quote)) {
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_QUOTE", quote: event.data.quote
      }).catch(() => {});
    }
    if (event.data.kind === "history" && event.data.history) {
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_HISTORY", history: event.data.history
      }).catch(() => {});
    }
    if (event.data.kind === "history-status") {
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_HISTORY_STATUS", status: event.data.status
      }).catch(() => {});
    }
  });
})();