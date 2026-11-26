const ANALYZER_URL = "https://wbpervago-commits.github.io/pocket-analyzer/";
const POCKET_URLS = [
  "https://pocketoption.com/*",
  "https://*.pocketoption.com/*",
  "https://*.po.market/*"
];

function sendToAnalyzers(message) {
  chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

function reportStatus(status, details = {}) {
  sendToAnalyzers({
    type: "POCKET_ANALYZER_HISTORY_STATUS",
    status,
    details
  });
}

function auditOpenAnalyzerTabs() {
  chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: () => {
          let rows;
          try {
            // historyArchive is a top-level lexical binding in the loaded
            // Pocket Analyzer page; MAIN-world injection can read it without
            // reloading that page or discarding its current in-memory archive.
            rows = historyArchive;
          } catch (error) {
            rows = null;
          }

          const host = document.querySelector(".grid > article.card");
          if (!host) return { ok: false, reason: "analyzer-card-not-found" };

          let panel = document.getElementById("historyAuditPanel");
          if (!panel) {
            panel = document.createElement("section");
            panel.id = "historyAuditPanel";
            panel.style.cssText = "margin-top:12px;padding:12px;border:1px solid #354967;border-radius:11px;background:#0e192a;color:#eef4ff;font:12px/1.5 system-ui";
            const head = host.querySelector(".card-head");
            if (head) head.insertAdjacentElement("afterend", panel);
            else host.prepend(panel);
          }
          panel.replaceChildren();

          const title = document.createElement("div");
          title.textContent = "Проверка исторического архива";
          title.style.cssText = "font-weight:700;margin-bottom:6px";
          panel.appendChild(title);

          if (!Array.isArray(rows)) {
            const message = document.createElement("div");
            message.textContent = "Не удалось получить historyArchive из текущей вкладки. Не обновляйте страницу: данные остаются в её памяти.";
            panel.appendChild(message);
            return { ok: false, reason: "historyArchive-not-accessible" };
          }

          const symbol = document.getElementById("pair")?.value || "unknown";
          const period = Number(document.getElementById("timeframe")?.value || 60);
          const normalizedTime = value => {
            const n = Number(value);
            if (!Number.isFinite(n)) return null;
            return n > 1e12 ? n / 1000 : n;
          };
          const minimumTimestamp = Date.UTC(2000, 0, 1) / 1000;
          const maximumTimestamp = Date.now() / 1000 + 3600;

          const validRows = [];
          const rejectedRows = [];
          let invalidTimestampRows = 0;
          let invalidOhlcRows = 0;
          for (const row of rows) {
            const time = normalizedTime(row?.time);
            if (time == null || time < minimumTimestamp || time > maximumTimestamp) {
              invalidTimestampRows++;
              rejectedRows.push({ row, reason: "timestamp-out-of-range" });
              continue;
            }
            const open = Number(row.open), high = Number(row.high);
            const low = Number(row.low), close = Number(row.close);
            if (![open, high, low, close].every(Number.isFinite) ||
                ![open, high, low, close].every(value => value > 0) ||
                high + 1e-10 < Math.max(open, close) ||
                low - 1e-10 > Math.min(open, close) ||
                high + 1e-10 < low) {
              invalidOhlcRows++;
              rejectedRows.push({ row, reason: "invalid-ohlc" });
              continue;
            }
            validRows.push({ time, open, high, low, close });
          }

          const sorted = validRows.map(row => row.time).sort((a, b) => a - b);
          const uniqueTimes = [];
          let duplicateTimestamps = 0;
          for (const stamp of sorted) {
            if (uniqueTimes.length && stamp === uniqueTimes[uniqueTimes.length - 1]) {
              duplicateTimestamps++;
            } else {
              uniqueTimes.push(stamp);
            }
          }

          let gapIntervals = 0;
          let estimatedMissingCandles = 0;
          let irregularIntervals = 0;
          let maxGapSeconds = 0;
          let exactPeriodIntervals = 0;
          let outOfOrderRows = 0;
          let previousOriginalTime = null;
          for (const row of validRows) {
            if (previousOriginalTime != null && row.time < previousOriginalTime) outOfOrderRows++;
            previousOriginalTime = row.time;
          }
          for (let i = 1; i < uniqueTimes.length; i++) {
            const delta = uniqueTimes[i] - uniqueTimes[i - 1];
            if (Math.abs(delta - period) < 1.5) {
              exactPeriodIntervals++;
            } else if (delta > period * 1.5) {
              gapIntervals++;
              maxGapSeconds = Math.max(maxGapSeconds, delta);
              estimatedMissingCandles += Math.max(0, Math.round(delta / period) - 1);
              if (Math.abs(delta / period - Math.round(delta / period)) > 0.02) irregularIntervals++;
            } else {
              irregularIntervals++;
            }
          }

          const first = uniqueTimes.length ? uniqueTimes[0] : null;
          const last = uniqueTimes.length ? uniqueTimes[uniqueTimes.length - 1] : null;
          const spanSeconds = first != null && last != null ? Math.max(0, last - first) : 0;
          const spanHours = spanSeconds / 3600;
          const spanDays = spanHours / 24;
          const iso = stamp => {
            try { return new Date(stamp * 1000).toISOString(); }
            catch (_) { return "некорректная дата"; }
          };
          const report = {
            symbol,
            timeframeSeconds: period,
            rawRows: rows.length,
            rows: validRows.length,
            rejectedRows: rejectedRows.length,
            validTimestampRows: validRows.length,
            uniqueTimestamps: uniqueTimes.length,
            duplicateTimestamps,
            invalidTimestampRows,
            invalidOhlcRows,
            firstTimestamp: first,
            lastTimestamp: last,
            firstDateUTC: first == null ? null : iso(first),
            lastDateUTC: last == null ? null : iso(last),
            spanSeconds,
            spanHours,
            spanDays,
            gapIntervals,
            estimatedMissingCandles,
            irregularIntervals,
            maxGapSeconds,
            exactPeriodIntervals,
            outOfOrderRows
          };

          const lines = [
            "Пара / ТФ: " + symbol + " · " + (period / 60) + " мин",
            "Строк: " + rows.length + " · пригодных: " + validRows.length + " · уникальных: " + uniqueTimes.length + " · дубликатов: " + duplicateTimestamps,
            "Диапазон UTC: " + (first == null ? "нет данных" : iso(first) + " — " + iso(last)),
            "Фактический диапазон: " + spanDays.toFixed(2) + " дней (" + spanHours.toFixed(1) + " ч)",
            "Пропуски: " + gapIntervals + " интервалов · ориентировочно отсутствует свечей: " + estimatedMissingCandles,
            "Неправильные интервалы: " + irregularIntervals + " · вне порядка: " + outOfOrderRows,
            "Ошибок времени: " + invalidTimestampRows + " · ошибок OHLC: " + invalidOhlcRows,
            "Максимальный интервал между свечами: " + maxGapSeconds + " сек."
          ];
          for (const line of lines) {
            const item = document.createElement("div");
            item.textContent = line;
            item.style.cssText = "margin:2px 0;color:#c5d3e6";
            panel.appendChild(item);
          }

          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Скачать очищенный архив и отчёт (" + validRows.length + " свечей)";
          button.style.cssText = "margin-top:9px;padding:8px 11px;border:1px solid #4c8dff;border-radius:7px;background:#172b49;color:#fff;font-weight:600;cursor:pointer";
          button.addEventListener("click", () => {
            const payload = {
              audit: report,
              rejectedRows,
              candles: validRows
            };
            const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "PocketAnalyzer_" + symbol + "_M" + (period / 60) + "_history_audit.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 60000);
            button.textContent = "Архив экспортирован";
          });
          panel.appendChild(button);

          const status = document.getElementById("historyStatus");
          if (status) {
            status.textContent = "Аудит: " + rows.length + " · " + spanDays.toFixed(2) +
              " дн. · пропуски " + estimatedMissingCandles + " · дубликаты " + duplicateTimestamps;
          }
          return { ok: true, report };
        }
      }).catch(error => {
        reportStatus("history-audit-injection-failed", { tabId: tab.id, error: String(error) });
      });
    }
  });
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === "update" || details.reason === "install") {
    auditOpenAnalyzerTabs();
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST" && message.request) {
    chrome.tabs.query({ url: POCKET_URLS }, tabs => {
      const candidates = tabs
        .filter(tab => tab.id != null && tab.id !== sender.tab?.id)
        .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

      if (!candidates.length) {
        reportStatus("pocket-tab-not-found", { purpose: message.request.purpose || "chart" });
        return;
      }

      const target = candidates[0];
      chrome.tabs.sendMessage(target.id, {
        type: "POCKET_ANALYZER_HISTORY_REQUEST_TO_PAGE",
        request: message.request
      }).catch(() => {
        reportStatus("pocket-tab-bridge-unavailable", { purpose: message.request.purpose || "chart" });
      });
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
    reportStatus(message.status, message.details || {});
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY" && message.history) {
    sendToAnalyzers({
      type: "POCKET_ANALYZER_HISTORY",
      history: message.history,
      symbol: message.symbol,
      period: message.period,
      purpose: message.purpose === "strategy" ? "strategy" : "chart"
    });
  }
});
