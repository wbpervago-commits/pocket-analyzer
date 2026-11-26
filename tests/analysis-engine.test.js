'use strict';
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../analysis-engine.js');

const engine = globalThis.PocketAnalysis;
assert.ok(engine, 'PocketAnalysis engine should attach to window');
assert.equal(typeof engine.detectChartPatterns, 'function');

assert.equal(typeof engine.normalizeLiveQuoteTimestamp, 'function');

{
  const now = Date.UTC(2026,10,25,22,13,47) / 1000;
  assert.equal(
    engine.normalizeLiveQuoteTimestamp(now + 2 * 3600, now),
    now,
    'A Pocket Option timestamp two hours ahead should be normalized to UTC'
  );
  assert.equal(
    engine.normalizeLiveQuoteTimestamp((now + 2 * 3600) * 1000, now),
    now,
    'Millisecond timestamps should be normalized before applying the broker offset'
  );
  assert.equal(
    engine.normalizeLiveQuoteTimestamp(now + 2 * 3600 - 180, now),
    now - 180,
    'A delayed quote with the same two-hour broker offset should preserve its age'
  );
  assert.equal(
    engine.normalizeLiveQuoteTimestamp(now + 1800, now),
    now + 1800,
    'A normal timestamp less than one hour ahead should not be shifted'
  );
  assert.equal(
    engine.normalizeLiveQuoteTimestamp(now + 2 * 3600 + 600, now),
    now + 2 * 3600 + 600,
    'An offset that is not close to a whole-hour shift should not be guessed'
  );
}

function flatCandles(count) {
  return Array.from({length:count}, (_,i) => ({
    time:i*60, open:1.1000, high:1.1010, low:1.0990, close:1.1000
  }));
}

{
  const rows=flatCandles(40);
  rows[39]={time:39*60,open:1.1012,high:1.1020,low:1.1004,close:1.1008};
  const result=engine.detectChartPatterns(rows,39,0.001);
  assert.equal(result.flags.falseBreakUp,true,'A wick above the prior range that closes back below is a false break up');
  assert.equal(result.families.falseBreakout,-1,'False break up should map to DOWN');
}

{
  const rows=flatCandles(40);
  rows[39]={time:39*60,open:1.0988,high:1.0998,low:1.0980,close:1.0992};
  const result=engine.detectChartPatterns(rows,39,0.001);
  assert.equal(result.flags.falseBreakDown,true,'A wick below the prior range that closes back above is a false break down');
  assert.equal(result.families.falseBreakout,1,'False break down should map to UP');
}

{
  const rows=flatCandles(48);
  rows[28]={time:28*60,open:1.0970,high:1.1020,low:1.0950,close:1.1000};
  rows[33]={time:33*60,open:1.1010,high:1.1030,low:1.1000,close:1.1010};
  rows[38]={time:38*60,open:1.0970,high:1.1020,low:1.0950,close:1.1000};
  rows[46]={time:46*60,open:1.1000,high:1.1030,low:1.0990,close:1.1025};
  rows[47]={time:47*60,open:1.1025,high:1.1040,low:1.1020,close:1.1032};
  const atSignal=engine.detectChartPatterns(rows,47,0.001);
  assert.equal(atSignal.flags.doubleBottomBreakout,true,'Two equal confirmed lows plus a neckline break should be recognized');
  assert.equal(atSignal.families.reversal,1,'A confirmed double bottom should map to UP');
  const alteredFuture=rows.concat([
    {time:48*60,open:1.2,high:1.3,low:1.1,close:1.25},
    {time:49*60,open:1.25,high:1.4,low:1.2,close:1.35}
  ]);
  assert.deepEqual(
    engine.detectChartPatterns(alteredFuture,47,0.001),
    atSignal,
    'The detector must not read candles after the requested index'
  );
}

{
  const trades=[
    {win:false,tie:false},{win:false,tie:false},{win:false,tie:false},
    {win:true,tie:false},
    {win:false,tie:false},{win:false,tie:false},{win:false,tie:false},{win:false,tie:false}
  ];
  const stats=engine.streakStats(trades);
  assert.equal(stats.maxLossStreak,4);
  assert.equal(stats.streaks3Plus,2);
  assert.equal(stats.streaks4Plus,1);

  const sample=Array.from({length:120},(_,i)=>({win:i%4!==0,tie:false,entryIndex:i}));
  const risk1=engine.estimateStreakRisk(sample);
  const risk2=engine.estimateStreakRisk(sample);
  assert.deepEqual(risk1,risk2,'Block-bootstrap risk projection should be deterministic');
  assert.equal(risk1.horizon,100);
  assert.equal(risk1.blockLength,5);
}

console.log('PASS: chart-pattern detection, no-lookahead guard, loss-streak metrics, deterministic block bootstrap');

{
  require('../experimental-strategy.js');
  const shock=globalThis.PocketShockExperiment;
  assert.ok(shock,'Experimental shock model should attach to window');
  assert.equal(typeof shock.buildShockContext,'function');
  assert.equal(typeof shock.calibrateShockContext,'function');
  assert.equal(typeof shock.evaluateShockConfluence,'function');

  // Stable synthetic M1 series, then a short synchronized downward shock.
  const rows=[];
  let price=1.1000;
  for(let i=0;i<8998;i++){
    let ret=0.000018*Math.sin(i*0.17)+0.000012*Math.cos(i*0.071);
    if(i>=8995&&i<=8997)ret-=0.000055;
    const open=price;
    const close=price*Math.exp(ret);
    const wick=0.000004+Math.abs(ret)*0.12;
    rows.push({time:i*60,open,high:Math.max(open,close)+wick,low:Math.min(open,close)-wick,close});
    price=close;
  }
  const context=shock.buildShockContext(rows);
  assert.ok(context.m1.length>8900);
  assert.ok(context.m2.length>4400);
  assert.ok(context.m5.length>1700);
  assert.ok(context.m15.length>500);

  const signalTime=8998*60;
  const calibration=shock.calibrateShockContext(context,signalTime,{
    windowDays:2,
    recalibrationDays:7,
    rvLowQuantile:0,
    rvHighQuantile:1,
    m5TrendQuantile:1,
    m15TrendQuantile:1,
    minFastSamples:100,
    minTrendSamples:30
  });
  assert.equal(calibration.ok,true,'Two days of synthetic M1 data should be enough for a test calibration');
  const testOptions={
    thresholds:[
      {z1:1,z2:1},
      {z1:1.5,z2:1.5},
      {z1:2,z2:2}
    ]
  };
  const decision=shock.evaluateShockConfluence(context,signalTime,0,calibration,testOptions);
  assert.equal(decision.direction,'UP','A synchronized downward M1/M2 shock should fade upward');
  assert.equal(decision.thresholds.z1,1);

  const futureRows=rows.concat([
    {time:8998*60,open:price,high:price*1.0001,low:price*0.9999,close:price*1.00005},
    {time:8999*60,open:price*1.00005,high:price*1.0002,low:price*1.0000,close:price*1.0001}
  ]);
  const futureContext=shock.buildShockContext(futureRows);
  const sameDecision=shock.evaluateShockConfluence(futureContext,signalTime,0,calibration,testOptions);
  assert.equal(sameDecision.direction,decision.direction,
    'Appending future candles must not alter a decision at an earlier synchronized close');

  const afterTwoLosses=shock.evaluateShockConfluence(context,signalTime,2,calibration,testOptions);
  assert.equal(afterTwoLosses.thresholds.z1,2,
    'After two losses the most restrictive threshold state must be selected');

  const broken=rows.filter((row,i)=>i!==4500);
  const brokenContext=shock.buildShockContext(broken);
  assert.ok(brokenContext.m2.length<context.m2.length,
    'A missing M1 candle must prevent aggregation of an incomplete M2 bar');
}

console.log('PASS: experimental M1/M2 shock model, quantile calibration, multi-timeframe guards and no-lookahead');


{
  const synthetic=[];
  let previous=1.1000;
  for(let i=0;i<620;i++){
    const close=1.1000+0.00035*Math.sin(i/9)+0.00010*Math.sin(i/2.3);
    const open=previous;
    const spread=0.00007+0.00002*(1+Math.sin(i/5));
    synthetic.push({time:i*60,open,high:Math.max(open,close)+spread,low:Math.min(open,close)-spread,close});
    previous=close;
  }
  const backtest=engine.backtest(synthetic,60,60,0.9);
  assert.equal(backtest.supported,true);
  assert.ok(Math.abs(backtest.breakEvenRate-100/1.9)<1e-10);
  assert.ok(backtest.models.some(x=>x.id==='pattern_all'),'Combined chart-pattern model should be included');
  assert.ok(backtest.models.some(x=>x.source==='chart-pattern'),'Chart-pattern models should be marked separately');
}

{
  const fs=require('node:fs');
  const path=require('node:path');
  const vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const inline=[...html.matchAll(/<script\b(?!(?:[^>]*\bsrc\s*=))[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(inline.length>=1,'index.html should contain the inline app script');
  inline.forEach((match,i)=>new vm.Script(match[1],{filename:'index.html:inline-'+i}));

  assert.ok(html.includes('const DISPLAY_CANDLE_LIMIT=2000'),'The visible chart must remain capped at 2,000 candles');
  assert.ok(html.includes('count:DISPLAY_CANDLE_LIMIT'),'The chart history request must stay separate and limited to 2,000 candles');
  assert.ok(html.includes('SHOCK_ARCHIVE_CANDLES=SHOCK_ARCHIVE_DAYS*24*60'),'The paper model must maintain its own 21-day M1 archive');
  assert.ok(html.includes('count,\n        stamp:reference,\n        purpose:\'strategy\''),'The hidden strategy archive must use a separate M1 history request');
  assert.ok(html.includes('buildShockContext(strategyArchive.slice(-1200))'),'Live decisions should use a bounded recent feature window');
  assert.ok(html.includes('id="shockExperimentStreaks"'),'The paper panel must show counts of 2+, 3+, 4+ and 5+ loss streaks');
  assert.ok(html.includes('remaining.toFixed(2)'),'The visible candle close countdown must retain hundredth-second precision');
  assert.ok(!html.includes('placeOrder(')&&!html.includes('openTrade('),'The paper model must not place trades');

}

