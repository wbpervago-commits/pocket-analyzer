const ANALYZER_URL = "https://wbpervago-commits.github.io/pocket-analyzer/";
const POCKET_URLS = [
  "https://pocketoption.com/*",
  "https://*.pocketoption.com/*",
  "https://*.po.market/*"
];
const ALLOWED_PAIRS = new Set([
  "EURUSD_otc", "GBPUSD_otc", "USDJPY_otc", "AUDCAD_otc", "EURGBP_otc"
]);
const ALLOWED_PERIODS = new Set([60, 120, 300, 900]);

function sendToTabs(query, message) {
  chrome.tabs.query(query, tabs => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  });
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "POCKET_ANALYZER_QUOTE" && Array.isArray(message.quote)) {
    const [symbol, timestamp, price] = message.quote;
    if (typeof symbol !== "string" || typeof timestamp !== "number" ||
        typeof price !== "number" || !Number.isFinite(timestamp) ||
        !Number.isFinite(price)) return;
    sendToTabs({ url: ANALYZER_URL + "*" }, {
      type: "POCKET_ANALYZER_QUOTE", quote: [symbol, timestamp, price]
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST") {
    const period = Number(message.period);
    if (!ALLOWED_PAIRS.has(message.symbol) || !ALLOWED_PERIODS.has(period)) return;
    const count = Math.min(2000, Math.max(1, Number(message.count) || Math.ceil(86400 / period)));
    sendToTabs({ url: POCKET_URLS }, {
      type: "POCKET_ANALYZER_HISTORY_REQUEST",
      symbol: message.symbol, period, count
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY" && message.history) {
    sendToTabs({ url: ANALYZER_URL + "*" }, {
      type: "POCKET_ANALYZER_HISTORY", history: message.history
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
    sendToTabs({ url: ANALYZER_URL + "*" }, {
      type: "POCKET_ANALYZER_HISTORY_STATUS", status: message.status
    });
  }
});