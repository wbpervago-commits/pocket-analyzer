/* Pocket Analyzer experimental shock-confluence research model.
 * Research-only: no order placement. All features use completed candles only.
 */
(function (root) {
  'use strict';

  const DAY = 86400;
  const MINUTE = 60;
  const DEFAULTS = Object.freeze({
    windowDays: 21,
    recalibrationDays: 7,
    rvLowQuantile: 0.65,
    rvHighQuantile: 0.95,
    m15TrendQuantile: 0.85,
    m5TrendQuantile: 0.60,
    thresholds: Object.freeze([
      Object.freeze({ z1: 2.2, z2: 1.5 }),
      Object.freeze({ z1: 2.6, z2: 1.8 }),
      Object.freeze({ z1: 3.2, z2: 2.1 })
    ]),
    minFastSamples: 100,
    minTrendSamples: 30
  });

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function validCandle(row) {
    if (!row || typeof row !== 'object') return false;
    const time = Number(row.time);
    const open = Number(row.open);
    const high = Number(row.high);
    const low = Number(row.low);
    const close = Number(row.close);
    return Number.isFinite(time) && time > 0 &&
      [open, high, low, close].every(Number.isFinite) &&
      [open, high, low, close].every(value => value > 0) &&
      high >= Math.max(open, close) &&
      low <= Math.min(open, close) &&
      high >= low;
  }

  function normalizeM1Candles(input) {
    if (!Array.isArray(input)) return [];
    const byTime = new Map();
    for (const row of input) {
      if (!validCandle(row)) continue;
      const time = Math.floor(Number(row.time) / MINUTE) * MINUTE;
      byTime.set(time, {
        time,
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close)
      });
    }
    const rows = [...byTime.values()].sort((a, b) => a.time - b.time);
    let segment = -1;
    let previous = null;
    for (const row of rows) {
      if (previous === null || row.time - previous !== MINUTE) segment += 1;
      row.segment = segment;
      previous = row.time;
    }
    return rows;
  }

  function aggregateCompletedBars(m1, periodMinutes) {
    if (periodMinutes === 1) {
      return m1.map(row => ({
        segment: row.segment,
        time: row.time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        confirmedAt: row.time + MINUTE
      }));
    }

    const periodSeconds = periodMinutes * MINUTE;
    const groups = new Map();
    for (const row of m1) {
      const bucket = Math.floor(row.time / periodSeconds) * periodSeconds;
      const key = row.segment + ':' + bucket;
      let group = groups.get(key);
      if (!group) {
        group = { segment: row.segment, time: bucket, rows: [] };
        groups.set(key, group);
      }
      group.rows.push(row);
    }

    const out = [];
    for (const group of groups.values()) {
      const rows = group.rows;
      if (rows.length !== periodMinutes) continue;
      if (rows[0].time !== group.time) continue;
      if (rows[rows.length - 1].time !== group.time + periodSeconds - MINUTE) continue;
      let contiguous = true;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].time - rows[i - 1].time !== MINUTE) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) continue;
      let high = -Infinity;
      let low = Infinity;
      for (const row of rows) {
        high = Math.max(high, row.high);
        low = Math.min(low, row.low);
      }
      out.push({
        segment: group.segment,
        time: group.time,
        open: rows[0].open,
        high,
        low,
        close: rows[rows.length - 1].close,
        confirmedAt: group.time + periodSeconds
      });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }

  function sampleStd(values) {
    const n = values.length;
    if (n < 2) return null;
    let sum = 0;
    for (const value of values) sum += value;
    const avg = sum / n;
    let squared = 0;
    for (const value of values) {
      const delta = value - avg;
      squared += delta * delta;
    }
    const variance = squared / (n - 1);
    return variance >= 0 ? Math.sqrt(variance) : null;
  }

  function buildShockFeatures(bars) {
    const returns = Array(bars.length).fill(null);
    const close = bars.map(row => row.close);
    const rv30 = Array(bars.length).fill(null);
    const zret5 = Array(bars.length).fill(null);

    for (let i = 1; i < bars.length; i++) {
      if (bars[i].segment !== bars[i - 1].segment) continue;
      if (close[i - 1] > 0 && close[i] > 0) returns[i] = Math.log(close[i] / close[i - 1]);
    }

    let segmentStart = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i > 0 && bars[i].segment !== bars[i - 1].segment) segmentStart = i;

      const returnValues = [];
      const from = Math.max(segmentStart, i - 30);
      for (let j = from; j < i; j++) {
        if (isFiniteNumber(returns[j])) returnValues.push(returns[j]);
      }
      if (returnValues.length >= 20) rv30[i] = sampleStd(returnValues);

      const priorIndex = i - 5;
      if (
        priorIndex >= segmentStart &&
        isFiniteNumber(rv30[i]) &&
        rv30[i] > 0 &&
        close[priorIndex] > 0
      ) {
        zret5[i] = Math.log(close[i] / close[priorIndex]) /
          (rv30[i] * Math.sqrt(5));
      }
    }

    return bars.map((row, i) => ({
      segment: row.segment,
      time: row.time,
      entryTime: row.confirmedAt,
      close: row.close,
      rv30: rv30[i],
      zret5: zret5[i]
    }));
  }

  function emaBySegment(bars, period) {
    const out = Array(bars.length).fill(null);
    const alpha = 2 / (period + 1);
    let segmentStart = 0;
    let value = null;
    for (let i = 0; i < bars.length; i++) {
      if (i === 0 || bars[i].segment !== bars[i - 1].segment) {
        segmentStart = i;
        value = bars[i].close;
      } else {
        value = bars[i].close * alpha + value * (1 - alpha);
      }
      if (i - segmentStart + 1 >= period) out[i] = value;
    }
    return out;
  }

  function buildTrendFeatures(bars) {
    const ema20 = emaBySegment(bars, 20);
    const ema50 = emaBySegment(bars, 50);
    const returns = Array(bars.length).fill(null);
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].segment === bars[i - 1].segment && bars[i - 1].close > 0) {
        returns[i] = Math.log(bars[i].close / bars[i - 1].close);
      }
    }

    const out = [];
    let segmentStart = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i > 0 && bars[i].segment !== bars[i - 1].segment) segmentStart = i;
      const values = [];
      const from = Math.max(segmentStart, i - 19);
      for (let j = from; j <= i; j++) {
        if (isFiniteNumber(returns[j])) values.push(returns[j]);
      }
      let strength = null;
      const rv20 = values.length >= 15 ? sampleStd(values) : null;
      if (
        isFiniteNumber(ema20[i]) &&
        isFiniteNumber(ema50[i]) &&
        isFiniteNumber(rv20) &&
        rv20 > 0 &&
        bars[i].close > 0
      ) {
        strength = Math.abs(ema20[i] - ema50[i]) /
          (bars[i].close * rv20 * Math.sqrt(20));
      }
      out.push({
        segment: bars[i].segment,
        time: bars[i].time,
        confirmedAt: bars[i].confirmedAt,
        trendStrength: strength,
        trendBias: isFiniteNumber(ema20[i]) && isFiniteNumber(ema50[i])
          ? Math.sign(ema20[i] - ema50[i])
          : 0
      });
    }
    return out;
  }

  function buildShockContext(input) {
    const m1 = normalizeM1Candles(input);
    const bars1 = aggregateCompletedBars(m1, 1);
    const bars2 = aggregateCompletedBars(m1, 2);
    const bars5 = aggregateCompletedBars(m1, 5);
    const bars15 = aggregateCompletedBars(m1, 15);
    return {
      candleCount: m1.length,
      firstTime: m1.length ? m1[0].time : null,
      lastTime: m1.length ? m1[m1.length - 1].time : null,
      m1: buildShockFeatures(bars1),
      m2: buildShockFeatures(bars2),
      m5: buildTrendFeatures(bars5),
      m15: buildTrendFeatures(bars15)
    };
  }

  function quantile(values, q) {
    const sorted = values.filter(isFiniteNumber).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const p = Math.max(0, Math.min(1, Number(q)));
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function calibrateShockContext(context, at, overrides = {}) {
    const options = Object.assign({}, DEFAULTS, overrides);
    const time = Number(at);
    if (!context || !Number.isFinite(time)) {
      return { ok: false, reason: 'invalid-calibration-input' };
    }
    const windowStart = time - Number(options.windowDays) * DAY;

    const m1rv = context.m1.filter(row =>
      isFiniteNumber(row.rv30) && row.entryTime >= windowStart && row.entryTime < time
    ).map(row => row.rv30);
    const m2rv = context.m2.filter(row =>
      isFiniteNumber(row.rv30) && row.entryTime >= windowStart && row.entryTime < time
    ).map(row => row.rv30);
    const m5trend = context.m5.filter(row =>
      isFiniteNumber(row.trendStrength) && row.confirmedAt >= windowStart && row.confirmedAt < time
    ).map(row => row.trendStrength);
    const m15trend = context.m15.filter(row =>
      isFiniteNumber(row.trendStrength) && row.confirmedAt >= windowStart && row.confirmedAt < time
    ).map(row => row.trendStrength);

    const counts = {
      m1: m1rv.length,
      m2: m2rv.length,
      m5: m5trend.length,
      m15: m15trend.length
    };
    if (
      m1rv.length < options.minFastSamples ||
      m2rv.length < options.minFastSamples ||
      m5trend.length < options.minTrendSamples ||
      m15trend.length < options.minTrendSamples
    ) {
      return { ok: false, reason: 'insufficient-calibration-history', windowStart, at: time, counts };
    }

    const calibration = {
      ok: true,
      calibratedAt: time,
      expiresAt: time + Number(options.recalibrationDays) * DAY,
      windowStart,
      windowDays: Number(options.windowDays),
      quantiles: {
        rvLow: Number(options.rvLowQuantile),
        rvHigh: Number(options.rvHighQuantile),
        m5Trend: Number(options.m5TrendQuantile),
        m15Trend: Number(options.m15TrendQuantile)
      },
      bounds: {
        m1RvLow: quantile(m1rv, options.rvLowQuantile),
        m1RvHigh: quantile(m1rv, options.rvHighQuantile),
        m2RvLow: quantile(m2rv, options.rvLowQuantile),
        m2RvHigh: quantile(m2rv, options.rvHighQuantile),
        m5TrendCap: quantile(m5trend, options.m5TrendQuantile),
        m15TrendCap: quantile(m15trend, options.m15TrendQuantile)
      },
      counts
    };
    if (Object.values(calibration.bounds).some(value => !isFiniteNumber(value))) {
      return { ok: false, reason: 'calibration-quantile-failed', windowStart, at: time, counts };
    }
    return calibration;
  }

  function latestConfirmed(rows, signalTime, segment) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.confirmedAt > signalTime) continue;
      if (row.segment === segment) return row;
      if (row.confirmedAt <= signalTime) break;
    }
    return null;
  }

  function findEntryFeature(rows, signalTime) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].entryTime === signalTime) return rows[i];
      if (rows[i].entryTime < signalTime) break;
    }
    return null;
  }

  function evaluateShockConfluence(context, signalTime, lossStreak, calibration, overrides = {}) {
    const options = Object.assign({}, DEFAULTS, overrides);
    const time = Number(signalTime);
    const streak = Math.max(0, Math.floor(Number(lossStreak) || 0));
    if (!context || !calibration || calibration.ok !== true) {
      return { direction: 'NONE', reason: 'calibration-not-ready' };
    }
    if (!Number.isFinite(time)) return { direction: 'NONE', reason: 'invalid-signal-time' };
    if (time % (2 * MINUTE) !== 0) {
      return { direction: 'NONE', reason: 'm1-m2-close-not-synchronized' };
    }
    if (time >= calibration.expiresAt) {
      return { direction: 'NONE', reason: 'calibration-expired' };
    }

    const m1 = findEntryFeature(context.m1, time);
    const m2 = findEntryFeature(context.m2, time);
    if (!m1 || !m2 || m1.segment !== m2.segment) {
      return { direction: 'NONE', reason: 'synchronized-m1-m2-bars-unavailable' };
    }
    if (![m1.rv30, m2.rv30, m1.zret5, m2.zret5].every(isFiniteNumber)) {
      return { direction: 'NONE', reason: 'shock-features-not-ready' };
    }

    const m5 = latestConfirmed(context.m5, time, m1.segment);
    const m15 = latestConfirmed(context.m15, time, m1.segment);
    if (!m5 || !m15 || !isFiniteNumber(m5.trendStrength) || !isFiniteNumber(m15.trendStrength)) {
      return { direction: 'NONE', reason: 'confirmed-higher-timeframe-bars-unavailable' };
    }

    const bounds = calibration.bounds;
    const inRvBand =
      m1.rv30 >= bounds.m1RvLow && m1.rv30 <= bounds.m1RvHigh &&
      m2.rv30 >= bounds.m2RvLow && m2.rv30 <= bounds.m2RvHigh;
    if (!inRvBand) {
      return {
        direction: 'NONE',
        reason: 'realized-volatility-outside-calibrated-band',
        features: { z1: m1.zret5, z2: m2.zret5, m1Rv: m1.rv30, m2Rv: m2.rv30 }
      };
    }
    if (m15.trendStrength > bounds.m15TrendCap) {
      return {
        direction: 'NONE',
        reason: 'm15-trend-strength-above-cap',
        features: { z1: m1.zret5, z2: m2.zret5, m15Trend: m15.trendStrength }
      };
    }
    if (m5.trendStrength > bounds.m5TrendCap) {
      return {
        direction: 'NONE',
        reason: 'm5-trend-strength-above-cap',
        features: { z1: m1.zret5, z2: m2.zret5, m5Trend: m5.trendStrength }
      };
    }

    const levels = options.thresholds;
    const level = levels[Math.min(streak, levels.length - 1)];
    const common = {
      reason: 'filters-passed-but-shock-not-strong-enough',
      thresholds: { z1: level.z1, z2: level.z2 },
      features: {
        z1: Math.abs(m1.zret5),
        z2: Math.abs(m2.zret5),
        signedZ1: m1.zret5,
        signedZ2: m2.zret5,
        m1Rv: m1.rv30,
        m2Rv: m2.rv30,
        m5Trend: m5.trendStrength,
        m15Trend: m15.trendStrength
      },
      lossStreak: streak,
      calibrationAt: calibration.calibratedAt
    };

    if (m1.zret5 <= -level.z1 && m2.zret5 <= -level.z2) {
      return Object.assign({}, common, {
        direction: 'UP',
        reason: 'synchronized-downward-shock-fade'
      });
    }
    if (m1.zret5 >= level.z1 && m2.zret5 >= level.z2) {
      return Object.assign({}, common, {
        direction: 'DOWN',
        reason: 'synchronized-upward-shock-fade'
      });
    }
    return Object.assign({}, common, { direction: 'NONE' });
  }

  root.PocketShockExperiment = {
    defaults: DEFAULTS,
    normalizeM1Candles,
    aggregateCompletedBars,
    buildShockContext,
    calibrateShockContext,
    evaluateShockConfluence,
    quantile
  };
})(window);
