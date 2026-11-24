(() => {
  const MARKER = "POCKET_ANALYZER_HISTORY_ONLY";
  const APP_MARKER = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;
  const runtimeAvailable = () => !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);

  if (isAnalyzer) {
    if (!runtimeAvailable()) return;

    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "POCKET_ANALYZER_HISTORY") {
        const rows = Array.isArray(message.history) ? message.history :
          (message.history?.data || message.history?.candles || message.history?.history || []);
        const statusEl = document.getElementById("historyStatus");
        if (statusEl) statusEl.textContent = "Ответ получен · свечей в пакете: " + (Array.isArray(rows) ? rows.length : "?");
        window.postMessage({ source: APP_MARKER, kind: "history", history: message.history }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
        const statusEl = document.getElementById("historyStatus");
        const d = message.details || {};
        const labels = {
          "socket-not-ready": "История: сокет не готов",
          "send-failed": "История: ошибка отправки",
          "history-hook-installed": "История: перехватчик установлен",
          "history-request-sent": "История: запрос отправлен, ждём ответ",
          "history-response-received": "Ответ Pocket Option: " + (d.event || "событие") + " · свечей: " + (d.rows ?? "?")
        };
        if (statusEl) statusEl.textContent = labels[message.status] || ("История: " + message.status);
        window.postMessage({ source: APP_MARKER, kind: "history-status", status: message.status, details: message.details }, "*");
      }
    });

    window.addEventListener("message", event => {
      if (event.source !== window || event.data?.source !== APP_MARKER ||
          event.data.kind !== "history-request") return;
      if (!runtimeAvailable()) return;
      const statusEl = document.getElementById("historyStatus");
      if (statusEl) statusEl.textContent = "История: передаю запрос в Pocket Option…";
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_HISTORY_REQUEST",
        request: {
          symbol: event.data.symbol,
          period: event.data.period,
          count: event.data.count,
          stamp: event.data.stamp
        }
      }).then(() => {
        if (statusEl) statusEl.textContent = "История: запрос передан, жду ответ страницы…";
      }).catch(() => {
        if (statusEl) statusEl.textContent = "История: ошибка связи расширения";
      });
    });
    return;
  }

  if (!runtimeAvailable()) return;
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== MARKER) return;

    if (event.data.kind === "history" && event.data.history) {
      if (!runtimeAvailable()) return;
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_HISTORY",
        history: event.data.history
      }).catch(() => {});
    }

    if (event.data.kind === "bridge-status") {
      const status = event.data.status === "history-socket-unavailable"
        ? "socket-not-ready"
        : event.data.status === "history-send-failed"
          ? "send-failed"
          : event.data.status;
      chrome.runtime.sendMessage({
        type: "POCKET_ANALYZER_HISTORY_STATUS",
        status,
        details: { event: event.data.event, rows: event.data.rows, keys: event.data.keys }
      }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST_TO_PAGE" && message.request) {
      window.postMessage({ source: MARKER, kind: "history-request", request: message.request }, "*");
    }
  });
})();