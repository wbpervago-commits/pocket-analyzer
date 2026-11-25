(() => {
  const MARKER = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;
  const runtimeAvailable = () => {
    try { return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id); }
    catch (_) { return false; }
  };
  const safeSendMessage = message => {
    if (!runtimeAvailable()) return;
    try {
      const pending = chrome.runtime.sendMessage(message);
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch (_) {}
  };

  if (!runtimeAvailable()) return;
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
      safeSendMessage({
        type: "POCKET_ANALYZER_QUOTE",
        quote: event.data.quote
      });
    }
  });
})();