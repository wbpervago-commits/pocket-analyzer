(() => {
  if (window.__pocketAnalyzerHistoryOnlyInstalled) return;
  window.__pocketAnalyzerHistoryOnlyInstalled = true;

  const marker = "POCKET_ANALYZER_HISTORY_ONLY";
  const NativeWebSocket = window.WebSocket;
  const pendingBinary = new WeakMap();
  const messageQueues = new WeakMap();
  const socketLabels = new WeakMap();

  let activeSocket = null;
  let pendingRequest = null;
  let inFlight = null;
  let requestSequence = 0;

  function post(status, details = {}) {
    const purpose = details.purpose || activeHistorySession?.purpose ||
      inFlight?.item?.session?.purpose || pendingRequest?.session?.purpose;
    window.postMessage({
      source: marker,
      kind: "bridge-status",
      status,
      ...details,
      ...(purpose ? { purpose } : {})
    }, "*");
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

  function containsMatchingQuote(value, symbol) {
    if (!symbol || value == null) return false;
    if (Array.isArray(value)) {
      if (value.length >= 3 && value[0] === symbol &&
          typeof value[1] === "number" && Number.isFinite(value[1]) &&
          typeof value[2] === "number" && Number.isFinite(value[2]) &&
          value[2] > 0) {
        let stamp = value[1];
        if (stamp > 1e12) stamp /= 1000;
        return stamp >= Date.UTC(2000, 0, 1) / 1000 &&
          stamp <= Date.now() / 1000 + 3600;
      }
      return value.some(item => containsMatchingQuote(item, symbol));
    }
    if (typeof value === "object") {
      return Object.values(value).some(item => containsMatchingQuote(item, symbol));
    }
    return false;
  }

  function recognizeRawQuoteStream(socket, payload, source) {
    const symbol = activeHistorySession?.symbol;
    if (!isOpen(socket) || !containsMatchingQuote(payload, symbol)) return false;

    const changed = activeSocket !== socket;
    activeSocket = socket;
    if (changed) {
      post("history-stream-detected", {
        event: source || "raw-quote-payload",
        endpoint: socketLabels.get(socket) || "unknown",
        readyState: socket.readyState
      });
    }
    flushPendingRequest();
    return true;
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

    // Some servers return a standalone JSON history result as a text frame.
    if (text.startsWith("{")) {
      try {
        if (acceptStandaloneHistoryResult(JSON.parse(text), socket, "json-result")) return;
      } catch (_) {}
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
      return;
    }

    // Some live quote packets are delivered as plain JSON frames, not Socket.IO events.
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        const payload = JSON.parse(text);
        if (recognizeRawQuoteStream(socket, payload, "plain-json-quote-frame")) return;
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

  function acceptStandaloneHistoryResult(result, socket, source) {
    const request = inFlight;
    if (!request || request.socket !== socket ||
        !result || typeof result !== "object" || Array.isArray(result)) return false;

    const resultIndex = Number(result.index);
    const requestIndex = Number(request.item.payload.index);
    const rows = extractRows(result);
    if (!Number.isFinite(resultIndex) || resultIndex !== requestIndex ||
        !Array.isArray(rows)) return false;

    inFlight = null;
    post("history-response-received", {
      event: source,
      rows: rows.length,
      index: resultIndex
    });
    acceptHistoryPage(request.item, result, source);
    return true;
  }

  async function inspect(data, socket) {
    if (typeof data === "string") {
      decodeTextFrame(data, socket);
      return;
    }

    const state = pendingBinary.get(socket);
    const decoded = await readBinary(data);
    if (decoded === null) return;

    // First handle Socket.IO binary-event attachments (45x-...).
    if (state) {
      state.parts.push(decoded);
      if (state.parts.length >= state.expected) {
        pendingBinary.delete(socket);
        const payload = replacePlaceholders(state.packet[1], state.parts);
        handlePacket([state.packet[0], payload], socket);
      }
      return;
    }

    // Some Pocket Option servers send the history result as a standalone
    // binary JSON WebSocket frame, without a preceding Socket.IO attachment header.
    if (acceptStandaloneHistoryResult(decoded, socket, "binary-result")) return;

    // Mirror the working Quote Bridge: recognize the selected asset's raw
    // [symbol, timestamp, price] tuples even when they arrive in binary frames.
    recognizeRawQuoteStream(socket, decoded, "binary-quote-frame");
  }

  const PAGE_CANDLE_LIMIT = 150;
  let activeHistorySession = null;
  let historySessionSequence = 0;

  function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const rows = payload.data || payload.candles || payload.history || [];
    return Array.isArray(rows) ? rows : [];
  }

  function rowTimestamp(row) {
    let value;
    if (Array.isArray(row)) value = row[0];
    else if (row && typeof row === "object") {
      value = row.time ?? row.timestamp ?? row.t;
    }
    let stamp = Number(value);
    if (!Number.isFinite(stamp)) return null;
    if (stamp > 1e12) stamp = Math.floor(stamp / 1000);
    const minimumTimestamp = Date.UTC(2000, 0, 1) / 1000;
    const maximumTimestamp = Date.now() / 1000 + 3600;
    if (stamp < minimumTimestamp || stamp > maximumTimestamp) return null;
    return Math.floor(stamp);
  }

  function makePage(session) {
    return {
      session,
      attempts: 0,
      payload: {
        asset: session.symbol,
        index: Math.floor(Date.now() / 10),
        // Pocket Option returns at most about 150 candles per history packet.
        // Its offset is the page duration in seconds (150 bars * period).
        offset: session.pageOffset,
        period: session.period,
        time: session.cursorTime
      }
    };
  }

  function finishSession(session, complete, reason) {
    if (session !== activeHistorySession) return;

    const rows = [...session.rows.entries()]
      .filter(([stamp]) => stamp > session.targetStart && stamp <= session.anchorTime)
      .sort((a, b) => a[0] - b[0])
      .map(([, row]) => row);
    const firstTime = rows.length ? rowTimestamp(rows[0]) : null;
    const lastTime = rows.length ? rowTimestamp(rows[rows.length - 1]) : null;
    const spanSeconds = firstTime == null || lastTime == null
      ? 0
      : Math.max(0, lastTime - firstTime);

    if (!complete) {
      post("history-incomplete", {
        pages: session.pages,
        rows: rows.length,
        spanSeconds,
        reason: reason || "history-window-not-covered"
      });
      return;
    }

    post("history-complete", {
      pages: session.pages,
      rows: rows.length,
      spanSeconds
    });

    window.postMessage({
      source: marker,
      kind: "history",
      history: { data: rows },
      symbol: session.symbol,
      period: session.period,
      purpose: session.purpose,
      complete: true,
      pages: session.pages,
      spanSeconds
    }, "*");
  }

  function queueNextPage(session, oldestTime) {
    if (session !== activeHistorySession) return;

    if (pendingRequest && pendingRequest.session !== session) {
      post("history-request-superseded");
      return;
    }

    if (oldestTime <= session.targetStart + session.period) {
      finishSession(session, true);
      return;
    }

    if (session.pages >= session.maxPages) {
      finishSession(session, false, "page-limit-reached");
      return;
    }

    if (oldestTime >= session.cursorTime) {
      finishSession(session, false, "history-page-did-not-move-backward");
      return;
    }

    session.cursorTime = oldestTime - session.period;
    pendingRequest = makePage(session);
    post("history-page-next", {
      page: session.pages + 1,
      expectedPages: session.maxPages,
      rows: session.rows.size
    });

    // Pocket Option history requests are session-throttled; keep at least
    // 200 ms between page requests so a long 90-day download remains reliable.
    window.setTimeout(() => {
      if (pendingRequest?.session === session) flushPendingRequest();
    }, 200);
  }

  function acceptHistoryPage(item, payload, eventName) {
    const session = item?.session;
    if (!session || session !== activeHistorySession) {
      flushPendingRequest();
      return;
    }

    const rows = extractRows(payload);
    session.pages += 1;

    let pageOldest = null;
    let pageNewest = null;
    let added = 0;

    for (const row of rows) {
      const stamp = rowTimestamp(row);
      if (stamp == null) continue;
      if (!session.rows.has(stamp)) added += 1;
      session.rows.set(stamp, row);
      pageOldest = pageOldest == null ? stamp : Math.min(pageOldest, stamp);
      pageNewest = pageNewest == null ? stamp : Math.max(pageNewest, stamp);
      session.minTime = session.minTime == null ? stamp : Math.min(session.minTime, stamp);
      session.maxTime = session.maxTime == null ? stamp : Math.max(session.maxTime, stamp);
    }

    post("history-page-received", {
      event: eventName,
      page: session.pages,
      expectedPages: session.maxPages,
      rows: rows.length,
      totalRows: session.rows.size
    });

    if (pageOldest == null) {
      finishSession(session, false, "empty-history-page");
      flushPendingRequest();
      return;
    }

    if (added === 0 && pageOldest >= session.cursorTime) {
      finishSession(session, false, "duplicate-history-page");
      flushPendingRequest();
      return;
    }

    queueNextPage(session, pageOldest);
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

        if (pendingRequest && pendingRequest.session !== item.session) {
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
          if (item.session === activeHistorySession) {
            finishSession(item.session, false, "history-response-timeout");
          } else {
            post("history-timeout", { attempts: item.attempts + 1 });
          }
          flushPendingRequest();
        }
      }, 30000);
    } catch (_) {
      pendingRequest = item;
      inFlight = null;
      post("history-send-failed");
    }
  }

  function flushPendingRequest() {
    if (inFlight || !pendingRequest) return;
    if (!isOpen(activeSocket)) {
      post("history-waiting-for-stream", {
        reason: activeSocket ? "active-socket-not-open" : "no-recognized-market-stream",
        endpoint: activeSocket ? (socketLabels.get(activeSocket) || "unknown") : "none",
        readyState: activeSocket ? activeSocket.readyState : -1
      });
      return;
    }
    const item = pendingRequest;
    pendingRequest = null;
    sendPayload(activeSocket, item);
  }

  function handlePacket(packet, socket) {
    if (!Array.isArray(packet) || typeof packet[0] !== "string") return;

    const name = packet[0];
    const payload = packet[1];

    // These events identify the subscribed market-data socket.
    if (name === "updateStream" || name === "updateHistoryNewFast" ||
        name === "loadHistoryPeriodFast") {
      if (isOpen(socket)) {
        const changed = activeSocket !== socket;
        activeSocket = socket;
        if (changed) {
          post("history-stream-detected", {
            event: name,
            endpoint: socketLabels.get(socket) || "unknown",
            readyState: socket.readyState
          });
        }
        flushPendingRequest();
      }
    }

    if (name === "loadHistoryPeriod" || name === "loadHistoryPeriodFast") {
      if (payload && typeof payload === "object") {
        const request = inFlight;
        inFlight = null;
        if (request) {
          const rows = extractRows(payload);
          post("history-response-received", { event: name, rows: rows.length });
          acceptHistoryPage(request.item, payload, name);
        } else {
          flushPendingRequest();
        }
      }
    }
  }

  function sendHistoryRequest(request) {
    if (!request || typeof request.symbol !== "string") return;

    const period = Number(request.period);
    const targetCandles = Number(request.count);
    if (!Number.isFinite(period) || period <= 0 ||
        !Number.isFinite(targetCandles) || targetCandles <= 0) {
      post("history-invalid-request");
      return;
    }

    const anchorTime = normalizeTimestamp(request.stamp, period);
    const pageCandles = Math.min(PAGE_CANDLE_LIMIT, Math.ceil(targetCandles));
    const pageOffset = pageCandles * Math.floor(period);

    const session = {
      id: ++historySessionSequence,
      symbol: request.symbol,
      period: Math.floor(period),
      purpose: request.purpose === "strategy" ? "strategy" : "chart",
      anchorTime,
      targetStart: anchorTime - Math.ceil(targetCandles) * Math.floor(period),
      cursorTime: anchorTime,
      pageOffset,
      maxPages: Math.ceil(targetCandles / pageCandles) + 2,
      pages: 0,
      rows: new Map(),
      minTime: null,
      maxTime: null
    };

    activeHistorySession = session;
    pendingRequest = makePage(session);

    post("history-session-started", {
      targetCandles: Math.ceil(targetCandles),
      pageCandles,
      maxPages: session.maxPages
    });

    if (!isOpen(activeSocket)) {
      post("history-waiting-for-stream", {
        reason: activeSocket ? "active-socket-not-open" : "no-recognized-market-stream",
        endpoint: activeSocket ? (socketLabels.get(activeSocket) || "unknown") : "none",
        readyState: activeSocket ? activeSocket.readyState : -1
      });
    }
    flushPendingRequest();
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
      let endpoint = "unknown";
      try {
        endpoint = new URL(String(args[0]), location.href).host;
      } catch (_) {}
      socketLabels.set(socket, endpoint);

      socket.addEventListener("open", () => {
        post("history-socket-open", {
          endpoint,
          readyState: socket.readyState
        });
      });

      socket.addEventListener("message", event => {
        const previous = messageQueues.get(socket) || Promise.resolve();
        const next = previous.then(() => inspect(event.data, socket)).catch(() => {});
        messageQueues.set(socket, next);
      });

      socket.addEventListener("close", event => {
        pendingBinary.delete(socket);
        post("history-socket-closed", {
          endpoint: socketLabels.get(socket) || "unknown",
          code: event.code,
          reason: event.reason || "no-reason",
          wasClean: event.wasClean
        });
        if (activeSocket === socket) activeSocket = null;
        if (inFlight?.socket === socket) {
          if (!pendingRequest) pendingRequest = inFlight.item;
          inFlight = null;
          post("history-request-queued", {
            reason: "socket-closed-before-response",
            code: event.code,
            endpoint: socketLabels.get(socket) || "unknown"
          });
        }
      });

      return socket;
    }
  });

  post("history-hook-installed");
})();