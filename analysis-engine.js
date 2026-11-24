/* Pocket Analyzer Analysis Engine 1.0
 * Deterministic OHLC-only indicators and walk-forward evaluation.
 * No future candle is read by evaluate().
 */
(function (root) {
  'use strict';

  const finite = Number.isFinite;
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

  function emaSeries(values, period) {
    const out = Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2 / (period + 1);
    let v = mean(values.slice(0, period));
    out[period - 1] = v;
    for (let i = period; i < values.length; i++) {
      v = values[i] * k + v * (1 - k);
      out[i] = v;
    }
    return out;
  }

  function rsiSeries(values, period = 14) {
    const out = Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    let avgGain = gains / period, avgLoss = losses / period;
    const calc = () => {
      if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
      if (avgGain === 0) return 0;
      return 100 - 100 / (1 + avgGain / avgLoss);
    };
    out[period] = calc();
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
      out[i] = calc();
    }
    return out;
  }

  function macdSeries(values) {
    const fast = emaSeries(values, 12), slow = emaSeries(values, 26);
    const line = values.map((_, i) => fast[i] == null || slow[i] == null ? null : fast[i] - slow[i]);
    const compact = line.filter(v => v != null);
    const signalCompact = emaSeries(compact, 9);
    const signal = Array(values.length).fill(null);
    let j = 0;
    for (let i = 0; i < line.length; i++) if (line[i] != null) signal[i] = signalCompact[j++];
    const hist = line.map((v, i) => v == null || signal[i] == null ? null : v - signal[i]);
    return { line, signal, hist };
  }

  function bandsSeries(values, period = 20, mult = 2) {
    const out = Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      const a = values.slice(i - period + 1, i + 1), m = mean(a);
      const sd = Math.sqrt(mean(a.map(x => (x - m) ** 2)));
      const upper = m + mult * sd, lower = m - mult * sd;
      const percentB = upper === lower ? 0.5 : (values[i] - lower) / (upper - lower);
      const position = percentB < 0 ? 'below-lower' : percentB < 0.2 ? 'near-lower' : percentB < 0.5 ? 'lower-half' : percentB < 0.8 ? 'upper-half' : percentB <= 1 ? 'near-upper' : 'above-upper';
      out[i] = { middle: m, upper, lower, percentB, width: m === 0 ? 0 : (upper - lower) / Math.abs(m), position, aboveMiddle: values[i] >= m };
    }
    return out;
  }

  function stochasticSeries(candles, period = 14, smooth = 3) {
    const k = Array(candles.length).fill(null), d = Array(candles.length).fill(null);
    for (let i = period - 1; i < candles.length; i++) {
      const window = candles.slice(i - period + 1, i + 1);
      const high = Math.max(...window.map(c => c.high)), low = Math.min(...window.map(c => c.low));
      k[i] = high === low ? 50 : 100 * (candles[i].close - low) / (high - low);
      const values = k.slice(Math.max(0, i - smooth + 1), i + 1).filter(v => v != null);
      if (values.length === smooth) d[i] = mean(values);
    }
    return { k, d };
  }

  function atrSeries(candles, period = 14) {
    const tr = candles.map((c, i) => {
      if (!i) return c.high - c.low;
      const p = candles[i - 1].close;
      return Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
    });
    const out = Array(candles.length).fill(null);
    if (tr.length < period) return out;
    let v = mean(tr.slice(0, period));
    out[period - 1] = v;
    for (let i = period; i < tr.length; i++) {
      v = (v * (period - 1) + tr[i]) / period;
      out[i] = v;
    }
    return out;
  }

  function adxSeries(candles, period = 14) {
    const n = candles.length, out = Array(n).fill(null);
    if (n < period * 2 + 1) return out;
    const plus = Array(n).fill(0), minus = Array(n).fill(0), tr = Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const up = candles[i].high - candles[i - 1].high;
      const down = candles[i - 1].low - candles[i].low;
      plus[i] = up > down && up > 0 ? up : 0;
      minus[i] = down > up && down > 0 ? down : 0;
      tr[i] = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    }
    let sTr = tr.slice(1, period + 1).reduce((a,b)=>a+b,0);
    let sP = plus.slice(1, period + 1).reduce((a,b)=>a+b,0);
    let sM = minus.slice(1, period + 1).reduce((a,b)=>a+b,0);
    const dx = Array(n).fill(null);
    for (let i = period; i < n; i++) {
      if (i > period) { sTr = sTr - sTr / period + tr[i]; sP = sP - sP / period + plus[i]; sM = sM - sM / period + minus[i]; }
      const pdi = sTr ? 100 * sP / sTr : 0, mdi = sTr ? 100 * sM / sTr : 0;
      dx[i] = pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0;
    }
    const first = period * 2 - 1;
    if (n <= first) return out;
    let a = mean(dx.slice(period, first + 1).filter(v => v != null));
    out[first] = a;
    for (let i = first + 1; i < n; i++) { a = (a * (period - 1) + dx[i]) / period; out[i] = a; }
    return out;
  }

  function candlePattern(c, p) {
    const range = Math.max(c.high - c.low, 1e-12);
    const body = Math.abs(c.close - c.open);
    const upper = c.high - Math.max(c.open, c.close);
    const lower = Math.min(c.open, c.close) - c.low;
    const bullEngulf = p && c.close > c.open && p.close < p.open && c.open <= p.close && c.close >= p.open;
    const bearEngulf = p && c.close < c.open && p.close > p.open && c.open >= p.close && c.close <= p.open;
    const bullPin = lower / range >= 0.58 && body / range <= 0.32 && upper / range <= 0.22;
    const bearPin = upper / range >= 0.58 && body / range <= 0.32 && lower / range <= 0.22;
    const inside = !!p && c.high < p.high && c.low > p.low;
    return { bullEngulf, bearEngulf, bullPin, bearPin, inside, doji: body / range <= 0.1 };
  }

  function higherTimeframeTrend(candles, timeframeSeconds) {
    const factor = timeframeSeconds === 60 ? 5 : timeframeSeconds === 120 ? 3 : timeframeSeconds === 300 ? 3 : 4;
    const higherSeconds = timeframeSeconds * factor;
    if (candles.length < factor * 20) return null;
    const currentGroup = Math.floor(candles[candles.length - 1].time / higherSeconds);
    const groups = new Map();
    for (const c of candles) {
      const key = Math.floor(c.time / higherSeconds);
      if (key >= currentGroup) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const bars = [];
    for (const [key, rows] of [...groups.entries()].sort((a,b)=>a[0]-b[0])) {
      if (rows.length !== factor) continue;
      bars.push({ time: key * higherSeconds, open: rows[0].open, high: Math.max(...rows.map(x=>x.high)), low: Math.min(...rows.map(x=>x.low)), close: rows[rows.length - 1].close });
    }
    const closes = bars.map(x=>x.close), e20 = emaSeries(closes, 20);
    if (closes.length < 22 || e20[e20.length - 1] == null) return null;
    const last = closes.length - 1;
    const slope = e20[last] - e20[last - 3];
    return { direction: closes[last] > e20[last] && slope > 0 ? 1 : closes[last] < e20[last] && slope < 0 ? -1 : 0, bars: bars.length, seconds: higherSeconds };
  }

  function evaluate(candles, timeframeSeconds = 60) {
    const n = candles.length;
    if (n < 60) return { ready: false, reason: 'Для анализа нужно минимум 60 свечей', score: 0, direction: 'NONE', confidence: null };
    const closes = candles.map(c => c.close);
    const e9 = emaSeries(closes, 9), e21 = emaSeries(closes, 21), e50 = emaSeries(closes, 50);
    const rs = rsiSeries(closes), mc = macdSeries(closes), bb = bandsSeries(closes), st = stochasticSeries(candles), atr = atrSeries(candles), adx = adxSeries(candles);
    const i = n - 1, c = candles[i], p = candles[i - 1];
    const pattern = candlePattern(c, p);
    const higherTrend = higherTimeframeTrend(candles, timeframeSeconds);
    let score = 0;
    const factors = [];
    const add = (v, label) => { score += v; if (v) factors.push({ value: v, label }); };

    if (e9[i] > e21[i] && e21[i] > e50[i]) add(2, 'EMA 9/21/50: восходящее расположение');
    else if (e9[i] < e21[i] && e21[i] < e50[i]) add(-2, 'EMA 9/21/50: нисходящее расположение');
    else if (e9[i] > e21[i]) add(1, 'EMA 9 выше EMA 21');
    else if (e9[i] < e21[i]) add(-1, 'EMA 9 ниже EMA 21');

    const slope = e21[i] - e21[Math.max(0, i - 5)];
    if (slope > 0) add(1, 'Наклон EMA 21 положительный');
    else if (slope < 0) add(-1, 'Наклон EMA 21 отрицательный');

    if (mc.hist[i] != null && mc.hist[i - 1] != null) {
      if (mc.hist[i] > 0 && mc.hist[i] > mc.hist[i - 1]) add(1, 'MACD: бычий импульс усиливается');
      else if (mc.hist[i] < 0 && mc.hist[i] < mc.hist[i - 1]) add(-1, 'MACD: медвежий импульс усиливается');
    }

    if (rs[i] != null) {
      if (rs[i] >= 52 && rs[i] <= 68) add(1, 'RSI поддерживает рост');
      else if (rs[i] <= 48 && rs[i] >= 32) add(-1, 'RSI поддерживает снижение');
      else if (rs[i] > 78 || rs[i] < 22) add(0, 'RSI в экстремальной зоне — нужен фильтр');
    }

    const b = bb[i];
    if (b) {
      if (b.percentB > 0.55 && b.percentB < 0.9) add(1, 'Цена в верхней части Bollinger');
      else if (b.percentB < 0.45 && b.percentB > 0.1) add(-1, 'Цена в нижней части Bollinger');
    }

    if (higherTrend && higherTrend.direction !== 0) {
      if (score > 0 && higherTrend.direction > 0) add(1, 'Старший таймфрейм подтверждает рост');
      else if (score < 0 && higherTrend.direction < 0) add(-1, 'Старший таймфрейм подтверждает снижение');
      else if (score > 0 && higherTrend.direction < 0) add(-1, 'Старший таймфрейм против роста');
      else if (score < 0 && higherTrend.direction > 0) add(1, 'Старший таймфрейм против снижения');
    }
    if (st.k[i] != null && st.d[i] != null) {
      if (st.k[i] > st.d[i] && st.k[i] >= 50 && st.k[i] <= 85) add(1, 'Stochastic подтверждает восходящий импульс');
      else if (st.k[i] < st.d[i] && st.k[i] <= 50 && st.k[i] >= 15) add(-1, 'Stochastic подтверждает нисходящий импульс');
    }
    if (adx[i] != null && adx[i] >= 20) add(score > 0 ? 1 : score < 0 ? -1 : 0, 'ADX подтверждает наличие тренда');
    if (pattern.bullEngulf || pattern.bullPin) add(1, pattern.bullEngulf ? 'Бычье поглощение' : 'Бычий пин-бар');
    if (pattern.bearEngulf || pattern.bearPin) add(-1, pattern.bearEngulf ? 'Медвежье поглощение' : 'Медвежий пин-бар');

    let breakoutDirection = 0;
    const lookback = candles.slice(Math.max(0, i - 20), i);
    if (lookback.length >= 15) {
      const priorHigh = Math.max(...lookback.map(x => x.high)), priorLow = Math.min(...lookback.map(x => x.low));
      if (c.close > priorHigh) { breakoutDirection = 1; add(2, 'Пробой максимума последних 20 свечей'); }
      else if (c.close < priorLow) { breakoutDirection = -1; add(-2, 'Пробой минимума последних 20 свечей'); }
    }

    const atrPct = atr[i] && c.close ? atr[i] / Math.abs(c.close) : null;
    const aligned = (score >= 4 && e9[i] > e21[i]) || (score <= -4 && e9[i] < e21[i]);
    const volatileEnough = atrPct != null && atrPct > 0.00002;
    const direction = aligned && volatileEnough ? (score >= 4 ? 'UP' : 'DOWN') : 'NONE';
    const strength = Math.min(95, Math.round(50 + Math.abs(score) * 5));
    return {
      ready: true, direction, score, confidence: direction === 'NONE' ? null : strength,
      indicators: { ema9: e9[i], ema21: e21[i], ema50: e50[i], rsi: rs[i], macd: mc.line[i], macdSignal: mc.signal[i], macdHist: mc.hist[i], stochasticK: st.k[i], stochasticD: st.d[i], bb: b, atr: atr[i], adx: adx[i], atrPct },
      pattern, higherTrend, factors,
      features: {
        emaStack: e9[i] > e21[i] && e21[i] > e50[i] ? 1 : e9[i] < e21[i] && e21[i] < e50[i] ? -1 : 0,
        emaSlopeDirection: slope > 0 ? 1 : slope < 0 ? -1 : 0,
        macdMomentumDirection: mc.hist[i] != null && mc.hist[i - 1] != null && mc.hist[i] > 0 && mc.hist[i] > mc.hist[i - 1] ? 1 : mc.hist[i] != null && mc.hist[i - 1] != null && mc.hist[i] < 0 && mc.hist[i] < mc.hist[i - 1] ? -1 : 0,
        rsiDirection: rs[i] >= 52 && rs[i] <= 68 ? 1 : rs[i] <= 48 && rs[i] >= 32 ? -1 : 0,
        bollingerDirection: b && b.percentB > 0.55 && b.percentB < 0.9 ? 1 : b && b.percentB < 0.45 && b.percentB > 0.1 ? -1 : 0,
        stochasticDirection: st.k[i] != null && st.d[i] != null && st.k[i] > st.d[i] && st.k[i] >= 50 && st.k[i] <= 85 ? 1 : st.k[i] != null && st.d[i] != null && st.k[i] < st.d[i] && st.k[i] <= 50 && st.k[i] >= 15 ? -1 : 0,
        breakoutDirection,
        patternDirection: pattern.bullEngulf || pattern.bullPin ? 1 : pattern.bearEngulf || pattern.bearPin ? -1 : 0,
        htfDirection: higherTrend ? higherTrend.direction : 0
      },
      reason: direction === 'NONE' ? 'Недостаточно согласованных факторов' : 'Направление подтверждено несколькими группами факторов'
    };
  }

  function streakStats(trades) {
    let current = 0, max = 0, streaks = [];
    const after = { 1: { opportunities: 0, losses: 0, wins: 0, ties: 0 }, 2: { opportunities: 0, losses: 0, wins: 0, ties: 0 }, 3: { opportunities: 0, losses: 0, wins: 0, ties: 0 } };
    for (const trade of trades) {
      if (current >= 1 && current <= 3) {
        const row = after[current];
        row.opportunities++;
        if (trade.tie) row.ties++;
        else if (trade.win) row.wins++;
        else row.losses++;
      }
      if (trade.tie) {
        if (current) streaks.push(current);
        current = 0;
      } else if (trade.win) {
        if (current) streaks.push(current);
        current = 0;
      } else {
        current++;
        if (current > max) max = current;
      }
    }
    if (current) streaks.push(current);
    return {
      trades: trades.length,
      maxLossStreak: max,
      currentLossStreak: current,
      streaks2Plus: streaks.filter(x => x >= 2).length,
      streaks3Plus: streaks.filter(x => x >= 3).length,
      streaks4Plus: streaks.filter(x => x >= 4).length,
      streaks5Plus: streaks.filter(x => x >= 5).length,
      afterLossRun: after
    };
  }

  function backtest(candles, expirySeconds, timeframeSeconds, payoutRate = 0.8) {
    if (!Number.isFinite(expirySeconds) || !Number.isFinite(timeframeSeconds) || expirySeconds < timeframeSeconds || expirySeconds % timeframeSeconds !== 0) return { supported: false, reason: 'Для точного теста экспирация должна быть не короче таймфрейма и кратна ему.' };
    const step = expirySeconds / timeframeSeconds;
    let signals = 0, wins = 0, losses = 0, ties = 0;
    const byDirection = { UP: { signals: 0, wins: 0, losses: 0, ties: 0 }, DOWN: { signals: 0, wins: 0, losses: 0, ties: 0 } };
    const groups = {};
    const outcomes = [], nonOverlappingOutcomes = [];
    let nextNonOverlappingIndex = 59;
    const addGroup = (key, result, win, tie) => {
      const g = groups[key] || (groups[key] = { signals: 0, wins: 0, losses: 0, ties: 0 });
      g.signals++;
      if (tie) g.ties++;
      else if (win) g.wins++;
      else g.losses++;
    };
    for (let i = 59; i + step < candles.length; i++) {
      const result = evaluate(candles.slice(0, i + 1), timeframeSeconds);
      if (result.direction === 'NONE') continue;
      const entry = candles[i + 1].open, exit = candles[i + step].close;
      const tie = Math.abs(exit - entry) < 1e-12;
      const win = !tie && (result.direction === 'UP' ? exit > entry : exit < entry);
      signals++;
      const side = byDirection[result.direction];
      side.signals++;
      if (tie) { ties++; side.ties++; }
      else if (win) { wins++; side.wins++; }
      else { losses++; side.losses++; }

      const adx = result.indicators?.adx;
      const tradeOutcome = { direction: result.direction, adx, win, tie, entryIndex: i + 1, score: result.score, features: result.features, higherDirection: result.features?.htfDirection ?? 0 };
      outcomes.push(tradeOutcome);
      if (i >= nextNonOverlappingIndex) {
        nonOverlappingOutcomes.push(tradeOutcome);
        nextNonOverlappingIndex = i + step;
      }
      const trendBand = adx == null ? 'ADX: нет данных' : adx < 20 ? 'ADX: ниже 20' : adx < 25 ? 'ADX: 20–25' : 'ADX: 25 и выше';
      const htf = !result.higherTrend || result.higherTrend.direction === 0 ? 'Старший ТФ: нейтральный/нет данных' :
        result.higherTrend.direction === (result.direction === 'UP' ? 1 : -1) ? 'Старший ТФ: совпадает' : 'Старший ТФ: против';
      const absScore = Math.abs(result.score);
      const scoreBand = absScore < 6 ? 'Баллы: 4–5' : absScore < 8 ? 'Баллы: 6–7' : 'Баллы: 8+';
      const sideLabel = result.direction === 'UP' ? 'ВВЕРХ' : 'ВНИЗ';
      addGroup(trendBand, result, win, tie);
      addGroup(htf, result, win, tie);
      addGroup(scoreBand, result, win, tie);
      addGroup(sideLabel + ' · ' + trendBand, result, win, tie);
      addGroup(sideLabel + ' · ' + htf, result, win, tie);
      addGroup(sideLabel + ' · ' + scoreBand, result, win, tie);
    }
    const decided = wins + losses;
    const winRate = decided ? wins / decided * 100 : null;
    const breakEvenRate = 100 / (1 + payoutRate);
    const expectedValue = decided ? (wins * payoutRate - losses) / decided : null;
    const diagnostics = Object.entries(groups).map(([label, g]) => ({
      label, ...g, winRate: g.wins + g.losses ? g.wins / (g.wins + g.losses) * 100 : null,
      expectedValue: g.wins + g.losses ? (g.wins * payoutRate - g.losses) / (g.wins + g.losses) : null
    }));
    const modelDefinitions = [
      { id:'down_all', label:'ВНИЗ · все сигналы', test:t=>t.direction==='DOWN' },
      { id:'up_all', label:'ВВЕРХ · все сигналы', test:t=>t.direction==='UP' },
      { id:'down_adx', label:'ВНИЗ · ADX 20–25', test:t=>t.direction==='DOWN' && t.adx>=20 && t.adx<25 },
      { id:'down_adx_htf', label:'ВНИЗ · ADX 20–25 + старший ТФ совпадает', test:t=>t.direction==='DOWN' && t.adx>=20 && t.adx<25 && t.higherDirection===-1 },
      { id:'down_adx_ema', label:'ВНИЗ · ADX 20–25 + EMA вниз', test:t=>t.direction==='DOWN' && t.adx>=20 && t.adx<25 && t.features?.emaStack===-1 },
      { id:'down_adx_macd', label:'ВНИЗ · ADX 20–25 + MACD медвежий', test:t=>t.direction==='DOWN' && t.adx>=20 && t.adx<25 && t.features?.macdMomentumDirection===-1 },
      { id:'down_adx_ema_macd', label:'ВНИЗ · ADX 20–25 + EMA + MACD', test:t=>t.direction==='DOWN' && t.adx>=20 && t.adx<25 && t.features?.emaStack===-1 && t.features?.macdMomentumDirection===-1 },
      { id:'down_adx_htf_ema_macd', label:'ВНИЗ · ADX 20–25 + HTF + EMA + MACD', test:t=>t.direction==='DOWN' && t.adx>=20 && t.adx<25 && t.higherDirection===-1 && t.features?.emaStack===-1 && t.features?.macdMomentumDirection===-1 },
      { id:'down_score_htf', label:'ВНИЗ · баллы 8+ + старший ТФ совпадает', test:t=>t.direction==='DOWN' && Math.abs(t.score)>=8 && t.higherDirection===-1 },
      { id:'down_full', label:'ВНИЗ · EMA + наклон + MACD + RSI + Bollinger + HTF', test:t=>t.direction==='DOWN' && t.features?.emaStack===-1 && t.features?.emaSlopeDirection===-1 && t.features?.macdMomentumDirection===-1 && t.features?.rsiDirection===-1 && t.features?.bollingerDirection===-1 && t.higherDirection===-1 },
      { id:'up_adx', label:'ВВЕРХ · ADX 20–25', test:t=>t.direction==='UP' && t.adx>=20 && t.adx<25 },
      { id:'up_adx_htf', label:'ВВЕРХ · ADX 20–25 + старший ТФ совпадает', test:t=>t.direction==='UP' && t.adx>=20 && t.adx<25 && t.higherDirection===1 },
      { id:'up_adx_ema_macd', label:'ВВЕРХ · ADX 20–25 + EMA + MACD', test:t=>t.direction==='UP' && t.adx>=20 && t.adx<25 && t.features?.emaStack===1 && t.features?.macdMomentumDirection===1 },
      { id:'up_full', label:'ВВЕРХ · EMA + наклон + MACD + RSI + Bollinger + HTF', test:t=>t.direction==='UP' && t.features?.emaStack===1 && t.features?.emaSlopeDirection===1 && t.features?.macdMomentumDirection===1 && t.features?.rsiDirection===1 && t.features?.bollingerDirection===1 && t.higherDirection===1 }
    ];
    const splitAt = Math.max(1, Math.floor(outcomes.length * 0.7));
    const summarizeModel = rows => {
      const w = rows.filter(x=>x.win && !x.tie).length;
      const l = rows.filter(x=>!x.win && !x.tie).length;
      const ties = rows.filter(x=>x.tie).length;
      const decided = w + l;
      const riskStats = streakStats(rows);
      return { signals: rows.length, wins:w, losses:l, ties, winRate: decided ? w/decided*100 : null,
        expectedValue: decided ? (w*payoutRate-l)/decided : null, maxLossStreak:riskStats.maxLossStreak };
    };
    const models = modelDefinitions.map(def => {
      const selected = outcomes.filter(def.test);
      const train = selected.filter(x=>x.entryIndex < (outcomes[splitAt]?.entryIndex ?? Infinity));
      const test = selected.filter(x=>x.entryIndex >= (outcomes[splitAt]?.entryIndex ?? Infinity));
      return { id:def.id, label:def.label, full:summarizeModel(selected), train:summarizeModel(train), test:summarizeModel(test),
        status: train.length >= 50 && test.length >= 30 ? 'tested' : 'small-sample' };
    });
    const risk = {
      overall: streakStats(outcomes),
      nonOverlapping: streakStats(nonOverlappingOutcomes),
      byDirection: {
        UP: streakStats(outcomes.filter(x => x.direction === 'UP')),
        DOWN: streakStats(outcomes.filter(x => x.direction === 'DOWN'))
      },
      downAdx20to25: streakStats(outcomes.filter(x => x.direction === 'DOWN' && x.adx != null && x.adx >= 20 && x.adx < 25)),
      windows: {
        last100: streakStats(outcomes.slice(-100)),
        last300: streakStats(outcomes.slice(-300)),
        last500: streakStats(outcomes.slice(-500))
      }
    };
    return { supported: true, signals, wins, losses, ties, winRate, breakEvenRate, expectedValue, byDirection, diagnostics, risk, models, modelSplitIndex: splitAt, expiryBars: step };
  }

  root.PocketAnalysis = { evaluate, backtest, emaSeries, rsiSeries, macdSeries, bandsSeries, stochasticSeries, atrSeries, adxSeries };
})(window);
