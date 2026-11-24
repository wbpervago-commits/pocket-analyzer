(() => {
  if (window.__pocketAnalyzerHistoryOnlyInstalled) return;
  window.__pocketAnalyzerHistoryOnlyInstalled = true;

  const marker = "POCKET_ANALYZER_HISTORY_ONLY";
  const NativeWebSocket = window.WebSocket;
  const pendingBinary = new WeakMap();
  const messageQueues = new WeakMap();

  let activeSocket = null;
  let pendingRequest = null;
  let inFlight = null;
  let requestSequence = 0;

  function post(status, details = {}) {
    window.postMessage({ source: marker, kind: "bridge-status", status, ...details }, "*");
  }

  function isOpen(socket) {
    return !!socket && socket.readyState === NativeWebSocket.OPEN;
  }

  function normalizeTimestamp(value, period) {
    let stamp = Number(value);
    if (!Number.isFinite(stamp) || stamp <= 0) stamp = Date.now() / 1000;
    if (stamp > 1e12) stamp /= 1000;
    return Math.floor(stamp / period) * period;
  }

  function replacePlaceholders(value, parts) {
    if (Array.isArray(value)) return value.map(item => replacePlaceholders(item, parts));
    if (!value || typeof value !== "object") return value;
    if (value._placeholder === true && Number.isInteger(value.num)) {
      return parts[value.num] ?? value;
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = replacePlaceholders(item, parts);
    }
    return result;
  }

  function decodeTextFrame(text, socket) {
    if (typeof text !== "string") return;

    // Standard Socket.IO event packet: 42["eventName", payload]
    if (text.startsWith("42")) {
      try {
        const packet = JSON.parse(text.slice(2));
        handlePacket(packet, socket);
      } catch (_) {}
      return;
    }

    // Socket.IO binary event header: 451-[...], followed by one or more
    // separate WebSocket binary message frames.
    const binaryMatch = text.match(/^45(\d+)-([\s\S]+)$/);
    if (binaryMatch) {
      try {
        const attachmentCount = Number(binaryMatch[1]);
        const packet = JSON.parse(binaryMatch[2]);
        if (!Array.isArray(packet) || typeof packet[0] !== "string") return;
        if (!attachmentCount) {
          handlePacket(packet, socket);
          return;
        }
        pendingBinary.set(socket, {
          packet,
          expected: attachmentCount,
          parts: []
        });
      } catch (_) {}
    }
  }

  async function readBinary(data) {
    let buffer;
    if (data instanceof Blob) buffer = await data.arrayBuffer();
    else if (data instanceof ArrayBuffer) buffer = data;
    else if (ArrayBuffer.isView(data)) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else return null;

    const text = new TextDecoder().decode(buffer);
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  async function inspect(data, socket) {
    if (typeof data === "string") {
      decodeTextFrame(data, socket);
      return;
    }

    const state = pendingBinary.get(socket);
    if (!state) return;

    const part = await readBinary(data);
    if (part === null) return;
    state.parts.push(part);

    if (state.parts.length >= state.expected) {
      pendingBinary.delete(socket);
      const payload = replacePlaceholders(state.packet[1], state.parts);
      handlePacket([state.packet[0], payload], socket);
    }
  }

  function sendPayload(socket, item) {
    if (!isOpen(socket)) {
      pendingRequest = item;
      post("history-request-queued", { reason: "socket-not-open" });
      return;
    }

    const id = ++requestSequence;
    const message = "42" + JSON.stringify(["loadHistoryPeriod", item.payload]);

    try {
      socket.send(message);
      inFlight = { id, item, socket };
      post("history-request-sent", {
        attempt: item.attempts + 1,
        period: item.payload.period,
        offsetSeconds: item.payload.offset,
        expectedCandles: Math.ceil(item.payload.offset / item.payload.period)
      });

      window.setTimeout(() => {
        if (!inFlight || inFlight.id !== id) return;

        if (pendingRequest) {
          inFlight = null;
          post("history-request-superseded");
          flushPendingRequest();
        } else if (item.attempts < 1 && isOpen(activeSocket)) {
          item.attempts += 1;
          inFlight = null;
          pendingRequest = item;
          post("history-request-retry", { attempt: item.attempts + 1 });
          flushPendingRequest();
        } else {
          inFlight = null;
          post("history-timeout", { attempts: item.attempts + 1 });
          flushPendingRequest();
        }
      }, 9000);
    } catch (_) {
      pendingRequest = item;
      inFlight = null;
      post("history-send-failed");
    }
  }

  function flushPendingRequest() {
    if (inFlight || !pendingRequest || !isOpen(activeSocket)) return;
    const item = pendingRequest;
    pendingRequest = null;
    sendPayload(activeSocket, item);
  }

  function handlePacket(packet, socket) {
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;

    const name = packet[0];
    const payload = packet[1];

    // These events identify the authenticated data socket. Pocket Option
    // sends some of them as Socket.IO binary events (451-...).
    if (name === "updateStream" || name === "updateHistoryNewFast" ||
        name === "loadHistoryPeriodFast") {
      if (isOpen(socket)) {
        activeSocket = socket;
        flushPendingRequest();
      }
    }

    // Only loadHistoryPeriod* completes the initial 24-hour history request.
    // updateHistoryNewFast is an incremental stream event and must not cancel
    // the pending request or be mistaken for the full history response.
    if (name === "loadHistoryPeriod" || name === "loadHistoryPeriodFast") {
      if (payload && typeof payload === "object") {
        const rows = Array.isArray(payload) ? payload :
          (payload.data || payload.candles || payload.history || []);
        const requestContext = inFlight?.item?.payload || null;
        inFlight = null;
        post("history-response-received", {
          event: name,
          rows: Array.isArray(rows) ? rows.length : 0,
          symbol: requestContext?.asset,
          period: requestContext?.period,
          keys: Object.keys(payload).slice(0, 10)
        });
        window.postMessage({
          source: marker,
          kind: "history",
          history: payload,
          symbol: requestContext?.asset,
          period: requestContext?.period
        }, "*");
        flushPendingRequest();
      }
    }
  }

  function sendHistoryRequest(request) {
    if (!request || typeof request.symbol !== "string") return;

    const period = Number(request.period);
    const count = Number(request.count);
    if (!Number.isFinite(period) || period <= 0 ||
        !Number.isFinite(count) || count <= 0) {
      post("history-invalid-request");
      return;
    }

    // Pocket Option's offset is a lookback window in SECONDS, not
    // a candle count. The analyzer sends count = 86400 / period, so
    // multiplying by period requests the full 24-hour window.
    const lookbackSeconds = Math.ceil(count) * Math.floor(period);
    const payload = {
      asset: request.symbol,
      index: Math.floor(Date.now() / 10),
      offset: Math.min(Math.max(Math.floor(lookbackSeconds), Math.floor(period)), 86400),
      period: Math.floor(period),
      time: normalizeTimestamp(request.stamp, period)
    };

    pendingRequest = { payload, attempts: 0 };
    if (isOpen(activeSocket)) {
      flushPendingRequest();
    } else {
      post("history-request-queued", { reason: "waiting-for-authenticated-stream" });
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
      const socket = Reflect.construct(target, args, newTarget);

      socket.addEventListener("message", event => {
        const previous = messageQueues.get(socket) || Promise.resolve();
        const next = previous.then(() => inspect(event.data, socket)).catch(() => {});
        messageQueues.set(socket, next);
      });

      socket.addEventListener("close", () => {
        pendingBinary.delete(socket);
        if (activeSocket === socket) activeSocket = null;
        if (inFlight?.socket === socket) {
          if (!pendingRequest) pendingRequest = inFlight.item;
          inFlight = null;
          post("history-request-queued", { reason: "socket-closed-before-response" });
        }
      });

      return socket;
    }
  });

  post("history-hook-installed");
})();