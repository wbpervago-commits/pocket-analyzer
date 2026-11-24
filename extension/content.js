(() => {
  const MARKER = "POCKET_ANALYZER_HISTORY_ONLY";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;

  // This experiment carries historical candles only. Live quotes remain
  // exclusively on the known-working Quote Bridge 1.0.0.
  const runtimeAvailable = () => !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);

  if (isAnalyzer) {
    if (!runtimeAvailable()) return;
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "POCKET_ANALYZER_HISTORY") {
        window.postMessage({ source: MARKER, kind: "history", history: message.history }, "*");
      }
    });

    window.addEventListener("message", event => {
      if (event.source !== window || event.data?.source !== "POCKET_ANALYZER_QUOTE_BRIDGE" ||
          event.data.kind !== "history-request") return;
      if (!runtimeAvailable()) return;
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_HISTORY_REQUEST",
        request: {
          symbol: event.data.symbol,
          period: event.data.period,
          count: event.data.count,
          stamp: event.data.stamp
        }
      }).catch(() => {});
    });
    return;
  }

  if (!runtimeAvailable()) return;
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== MARKER ||
        event.data.kind !== "history" || !event.data.history) return;
    if (!runtimeAvailable()) return;
    chrome.runtime.sendMessage({
      type: "POCKET_ANALYZER_HISTORY",
      history: event.data.history
    }).catch(() => {});
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST_TO_PAGE" && message.request) {
      window.postMessage({ source: MARKER, kind: "history-request", request: message.request }, "*");
    }
  });
})();