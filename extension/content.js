(() => {
  const MARKER = "POCKET_ANALYZER_HISTORY_ONLY";
  const APP_MARKER = "POCKET_ANALYZER_QUOTE_BRIDGE";
  const analyzerHost = "wbpervago-commits.github.io";
  const isAnalyzer = location.hostname === analyzerHost;
  const runtimeAvailable = () => {
    try { return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id); }
    catch (_) { return false; }
  };
  const sendRuntimeMessage = message => new Promise(resolve => {
    if (!runtimeAvailable()) {
      resolve({ ok: false, reason: "extension-context-unavailable" });
      return;
    }
    try {
      const pending = chrome.runtime.sendMessage(message);
      Promise.resolve(pending).then(
        response => resolve({ ok: true, response }),
        () => resolve({ ok: false, reason: "runtime-message-rejected" })
      );
    } catch (_) {
      resolve({ ok: false, reason: "extension-context-invalidated" });
    }
  });

  if (isAnalyzer) {
    if (!runtimeAvailable()) return;

    window.addEventListener("message", event => {
      if (event.source !== window || event.data?.source !== APP_MARKER ||
          event.data.kind !== "history-bridge-ping") return;
      window.postMessage({
        source: APP_MARKER,
        kind: "history-bridge-ready",
        version: chrome.runtime.getManifest().version
      }, "*");
    });

    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === "POCKET_ANALYZER_HISTORY") {
        const selectedSymbol = document.getElementById("pair")?.value;
        const selectedPeriod = Number(document.getElementById("timeframe")?.value);
        const purpose = message.purpose === "strategy" ? "strategy" : "chart";
        if (message.symbol && selectedSymbol && message.symbol !== selectedSymbol) return;
        if (purpose === "strategy" && Number(message.period) !== 60) return;
        if (purpose === "chart" && message.period && Number.isFinite(selectedPeriod) &&
            selectedPeriod > 0 && Number(message.period) !== selectedPeriod) return;
        const rows = Array.isArray(message.history) ? message.history :
          (message.history?.data || message.history?.candles || message.history?.history || []);
        const statusEl = document.getElementById("historyStatus");
        if (statusEl) statusEl.textContent = "Ответ получен · свечей в пакете: " + (Array.isArray(rows) ? rows.length : "?");
        window.postMessage({
          source: APP_MARKER,
          kind: "history",
          history: message.history,
          symbol: message.symbol,
          period: message.period,
          purpose
        }, "*");
      }
      if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
        const statusEl = document.getElementById("historyStatus");
        const d = message.details || {};
        const labels = {
          "socket-not-ready": "История: ожидаем подключение WebSocket",
          "send-failed": "История: ошибка отправки запроса",
          "history-hook-installed": "История: перехватчик активен",
          "history-request-queued": "История: запрос сохранён · " + (d.reason || "ожидаем поток") + (d.code ? " · код " + d.code : ""),
          "history-socket-open": "История: WebSocket открыт · " + (d.endpoint || "сервер"),
          "history-socket-closed": "История: WebSocket закрыт · код " + (d.code ?? "?") + " · " + (d.reason || "без причины"),
          "history-stream-detected": "История: поток найден · " + (d.event || "событие") + " · " + (d.endpoint || "сервер"),
          "history-waiting-for-stream": "История: ждём поток · " + (d.reason || "нет соединения") + (d.endpoint ? " · " + d.endpoint : ""),
          "history-session-started": "История: загружаем " + (d.targetCandles || "?") + " свечей · готовим пакеты",
          "history-request-sent": "История: пакет отправлен · ждём ответ",
          "history-request-retry": "История: повторный запрос · ждём ответ",
          "history-page-received": "История: пакет " + (d.page ?? "?") + "/" + (d.expectedPages ?? "?") + " · получено " + (d.totalRows ?? d.rows ?? "?") + " свечей",
          "history-page-next": "История: загружаем следующий пакет · уже " + (d.rows ?? "?") + " свечей",
          "history-complete": "История: целевой период собран · " + (d.rows ?? "?") + " свечей",
          "history-incomplete": "История: загрузка не завершена · " + (d.rows ?? 0) + " свечей" + (d.reason ? " · " + d.reason : ""),
          "history-request-superseded": "История: старый запрос отменён · отправляется новый",
          "history-timeout": "История: Pocket Option не ответил на запрос",

          "history-invalid-request": "История: некорректные параметры запроса",
          "pocket-tab-not-found": "История: откройте вкладку Pocket Option",
          "pocket-tab-bridge-unavailable": "История: расширение не подключено к вкладке Pocket Option",
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
      sendRuntimeMessage({
        type: "POCKET_ANALYZER_HISTORY_REQUEST",
        request: {
          symbol: event.data.symbol,
          period: event.data.period,
          count: event.data.count,
          stamp: event.data.stamp,
          purpose: event.data.purpose === "strategy" ? "strategy" : "chart"
        }
      }).then(result => {
        if (!statusEl) return;
        statusEl.textContent = result.ok
          ? "История: запрос передан, жду ответ страницы…"
          : "История: контекст расширения обновлён · перезагрузите вкладку Pocket Option";
      });
    });
    return;
  }

  if (!runtimeAvailable()) return;
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== MARKER) return;

    if (event.data.kind === "history" && event.data.history) {
      if (!runtimeAvailable()) return;
      void sendRuntimeMessage({
        type: "POCKET_ANALYZER_HISTORY",
        history: event.data.history,
        symbol: event.data.symbol,
        period: event.data.period,
        purpose: event.data.purpose === "strategy" ? "strategy" : "chart"
      });
    }

    if (event.data.kind === "bridge-status") {
      const status = event.data.status === "history-socket-unavailable"
        ? "socket-not-ready"
        : event.data.status === "history-send-failed"
          ? "send-failed"
          : event.data.status;
      void sendRuntimeMessage({
        type: "POCKET_ANALYZER_HISTORY_STATUS",
        status,
        details: {
          event: event.data.event,
          rows: event.data.rows,
          keys: event.data.keys,
          page: event.data.page,
          expectedPages: event.data.expectedPages,
          totalRows: event.data.totalRows,
          spanSeconds: event.data.spanSeconds,
          reason: event.data.reason,
          targetCandles: event.data.targetCandles,
          pageCandles: event.data.pageCandles,
          maxPages: event.data.maxPages,
          purpose: event.data.purpose
        }
      });
    }
  });

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST_TO_PAGE" && message.request) {
      window.postMessage({ source: MARKER, kind: "history-request", request: message.request }, "*");
    }
  });
})();