const ANALYZER_URL = "https://wbpervago-commits.github.io/pocket-analyzer/";

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "POCKET_ANALYZER_QUOTE" || !Array.isArray(message.quote)) return;
  const [symbol, timestamp, price] = message.quote;
  if (
    typeof symbol !== "string" ||
    typeof timestamp !== "number" ||
    typeof price !== "number" ||
    !Number.isFinite(timestamp) ||
    !Number.isFinite(price)
  ) return;

  chrome.tabs.query({ url: ANALYZER_URL + "*" }, tabs => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, {
        type: "POCKET_ANALYZER_QUOTE",
        quote: [symbol, timestamp, price]
      }).catch(() => {});
    }
  });
});