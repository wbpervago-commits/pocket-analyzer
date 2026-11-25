'use strict';
const assert = require('node:assert/strict');

globalThis.window = globalThis;
require('../analysis-engine.js');

const engine = globalThis.PocketAnalysis;
assert.ok(engine, 'PocketAnalysis engine should attach to window');
assert.equal(typeof engine.detectChartPatterns, 'function');

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
}

