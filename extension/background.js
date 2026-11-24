const ANALYZER_URL = "https://wbpervago-commits.github.io/pocket-analyzer/";
const POCKET_URLS = [
  "https://pocketoption.com/*",
  "https://*.pocketoption.com/*",
  "https://*.po.market/*"
];

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "POCKET_ANALYZER_QUOTE" && Array.isArray(message.quote)) {
    const [symbol, timestamp, price] = message.quote;
    if (typeof symbol !== "string" || typeof timestamp !== "number" ||
        typeof price !== "number" || !Number.isFinite(timestamp) ||
        !Number.isFinite(price)) return;
    chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "POCKET_ANALYZER_QUOTE", quote: [symbol, timestamp, price]
        }).catch(() => {});
      }
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY_REQUEST") {
    const allowed = ["EURUSD_otc", "GBPUSD_otc", "USDJPY_otc", "AUDCAD_otc", "EURGBP_otc"];
    const period = Number(message.period);
    if (!allowed.includes(message.symbol) || ![60, 120, 300, 900].includes(period)) return;
    const count = Math.min(2000, Math.max(1, Number(message.count) || Math.ceil(86400 / period)));
    chrome.tabs.query({ url: POCKET_URLS }, tabs => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "POCKET_ANALYZER_HISTORY_REQUEST",
          symbol: message.symbol, period, count
        }).catch(() => {});
      }
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY" && message.history) {
    chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "POCKET_ANALYZER_HISTORY", history: message.history
        }).catch(() => {});
      }
    });
    return;
  }

  if (message?.type === "POCKET_ANALYZER_HISTORY_STATUS") {
    chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: "POCKET_ANALYZER_HISTORY_STATUS", status: message.status
        }).catch(() => {});
      }
    });
  }
});