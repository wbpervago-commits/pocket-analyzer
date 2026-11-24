(() => {
  if (window.__pocketAnalyzerHistoryOnlyInstalled) return;
  window.__pocketAnalyzerHistoryOnlyInstalled = true;

  const marker = "POCKET_ANALYZER_HISTORY_ONLY";
  const NativeWebSocket = window.WebSocket;
  let activeSocket = null;

  function post(kind, extra = {}) {
    window.postMessage({ source: marker, kind, ...extra }, "*");
  }

  function handlePacket(packet, socket) {
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
    const name = packet[0];
    const payload = packet[1];

    if (name === "updateStream") {
      activeSocket = socket;
      return;
    }

    if (name === "loadHistoryPeriod" || name === "loadHistoryPeriodFast" ||
        name === "updateHistoryNew" || name === "updateHistoryNewFast") {
      if (payload && typeof payload === "object") {
        const rows = Array.isArray(payload) ? payload :
          (payload.data || payload.candles || payload.history || []);
        post("bridge-status", {
          status: "history-response-received",
          event: name,
          rows: Array.isArray(rows) ? rows.length : 0,
          keys: Object.keys(payload).slice(0, 8)
        });
        post("history", { history: payload });
      }
    }
  }

  async function inspect(data, socket) {
    try {
      if (typeof data === "string") {
        if (data.startsWith("42")) handlePacket(JSON.parse(data.slice(2)), socket);
        return;
      }
      let buffer;
      if (data instanceof Blob) buffer = await data.arrayBuffer();
      else if (data instanceof ArrayBuffer) buffer = data;
      else if (ArrayBuffer.isView(data)) {
        buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      } else return;
      const decoded = new TextDecoder().decode(buffer);
      if (decoded.startsWith("42")) handlePacket(JSON.parse(decoded.slice(2)), socket);
    } catch (_) {}
  }

  function sendHistoryRequest(request) {
    if (!request || typeof request.symbol !== "string") return;
    const period = Number(request.period);
    const count = Number(request.count);
    const stamp = Number(request.stamp);
    if (!Number.isFinite(period) || period <= 0 || !Number.isFinite(count) || count <= 0) return;

    if (!activeSocket || activeSocket.readyState !== NativeWebSocket.OPEN) {
      post("bridge-status", { status: "history-socket-unavailable" });
      return;
    }

    const payload = {
      asset: request.symbol,
      index: Math.floor(Date.now() / 10),
      offset: Math.min(Math.max(Math.floor(count), 1), 2000),
      period,
      time: Number.isFinite(stamp) && stamp > 0 ? Math.floor(stamp) : Math.floor(Date.now() / 1000)
    };

    try {
      activeSocket.send("42" + JSON.stringify(["loadHistoryPeriod", payload]));
      post("bridge-status", { status: "history-request-sent" });
    } catch (_) {
      post("bridge-status", { status: "history-send-failed" });
    }
  }

  window.addEventListener("message", event => {
    if (event.source === window && event.data?.source === marker &&
        event.data.kind === "history-request" && event.data.request) {
      sendHistoryRequest(event.data.request);
    }
  });

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const ws = Reflect.construct(target, args, newTarget);
      ws.addEventListener("message", event => { void inspect(event.data, ws); });
      ws.addEventListener("close", () => { if (activeSocket === ws) activeSocket = null; });
      return ws;
    }
  });

  post("bridge-status", { status: "history-hook-installed" });
})();