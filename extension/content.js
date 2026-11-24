(() => {
  const MARKER = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;

  function sendRuntimeMessage(message) {
    try {
      const result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (_) {
      // Контекст расширения мог быть перезагружен вместе с вкладкой.
    }
  }

  if (isAnalyzer) {
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "POCKET_ANALYZER_QUOTE" && Array.isArray(message.quote)) {
        window.postMessage({ source: MARKER, kind: "quote", quote: message.quote }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_HISTORY" && message.history) {
        window.postMessage({ source: MARKER, kind: "history", history: message.history }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
        window.postMessage({ source: MARKER, kind: "history-status", status: message.status }, "*");
      }
    });

    window.addEventListener("message", event => {
      if (event.source !== window || event.data?.source !== MARKER) return;
      if (event.data.kind === "history-request") {
        const { symbol, period, count } = event.data;
        sendRuntimeMessage({
          type: "POCKET_ANALYZER_HISTORY_REQUEST", symbol, period, count
        });
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
    if (event.data.kind === "quote" && Array.isArray(event.data.quote)) {
      sendRuntimeMessage({ type: "POCKET_ANALYZER_QUOTE", quote: event.data.quote });
    }
    if (event.data.kind === "history" && event.data.history) {
      sendRuntimeMessage({ type: "POCKET_ANALYZER_HISTORY", history: event.data.history });
    }
    if (event.data.kind === "history-status") {
      sendRuntimeMessage({ type: "POCKET_ANALYZER_HISTORY_STATUS", status: event.data.status });
    }
  });
})();