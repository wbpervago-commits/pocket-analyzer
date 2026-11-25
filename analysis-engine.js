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

  function lineThrough(a,b,x){
    if(!a||!b||b.index===a.index)return a?a.price:0;
    return a.price+(b.price-a.price)*(x-a.index)/(b.index-a.index);
  }

  function regressionLine(values){
    const n=values.length;
    if(!n)return {slope:0,at:()=>0};
    const mx=(n-1)/2,my=mean(values);
    let numerator=0,denominator=0;
    for(let i=0;i<n;i++){numerator+=(i-mx)*(values[i]-my);denominator+=(i-mx)*(i-mx);}
    const slope=denominator?numerator/denominator:0,intercept=my-slope*mx;
    return {slope,at:x=>intercept+slope*x};
  }

  function oneWayDirection(up,down){
    return up&&!down?1:down&&!up?-1:0;
  }

  // Causal OHLC pattern detector. Swing points are only accepted after two
  // right-hand bars exist; nothing after the requested index is inspected.
  function detectChartPatterns(candles,index,atrValue){
    const flags={
      falseBreakUp:false,falseBreakDown:false,
      resistanceRejected:false,supportHeld:false,
      doubleTopBreakdown:false,doubleBottomBreakout:false,
      tripleTopBreakdown:false,tripleBottomBreakout:false,
      headShouldersBreakdown:false,inverseHeadShouldersBreakout:false,
      ascendingTriangleBreakout:false,descendingTriangleBreakdown:false,
      symmetricTriangleBreakoutUp:false,symmetricTriangleBreakoutDown:false,
      risingWedgeBreakdown:false,fallingWedgeBreakout:false,
      rectangleBreakoutUp:false,rectangleBreakoutDown:false,
      bullFlagBreakout:false,bearFlagBreakdown:false,
      bullPennantBreakout:false,bearPennantBreakdown:false,
      bullishRetest:false,bearishRetest:false,
      bullChannelBounce:false,bearChannelBounce:false
    };
    const emptyFamilies={falseBreakout:0,levelReaction:0,reversal:0,triangles:0,continuation:0,retest:0,channels:0,rangeBreakout:0,all:0};
    const empty={flags,families:emptyFamilies,direction:0,labels:[],count:0};
    if(index<23)return empty;

    const start=Math.max(0,index-63),w=candles.slice(start,index+1),n=w.length;
    if(n<23)return empty;
    const c=w[n-1],p=w[n-2];
    let atr=Number(atrValue);
    if(!(atr>0)){
      atr=mean(w.slice(-14).map(x=>x.high-x.low))||Math.abs(c.close)*1e-6;
    }
    atr=Math.max(atr,Math.abs(c.close)*1e-7,1e-10);
    const tolerance=0.35*atr;
    const highs=[],lows=[];
    for(let k=2;k<n-2;k++){
      const leftHigh=Math.max(w[k-2].high,w[k-1].high);
      const rightHigh=Math.max(w[k+1].high,w[k+2].high);
      const leftLow=Math.min(w[k-2].low,w[k-1].low);
      const rightLow=Math.min(w[k+1].low,w[k+2].low);
      if(w[k].high>leftHigh&&w[k].high>=rightHigh)highs.push({index:k,price:w[k].high});
      if(w[k].low<leftLow&&w[k].low<=rightLow)lows.push({index:k,price:w[k].low});
    }
    const directionFrom=(up,down)=>oneWayDirection(up,down);
    const hasRepeated=(points,count,maxSpread,maxGap=32)=>{
      const group=points.slice(-count);
      if(group.length!==count)return null;
      if(group[group.length-1].index-group[0].index>maxGap)return null;
      for(let j=1;j<group.length;j++){
        const gap=group[j].index-group[j-1].index;
        if(gap<3||gap>maxGap)return null;
      }
      const prices=group.map(x=>x.price);
      if(Math.max(...prices)-Math.min(...prices)>maxSpread)return null;
      return group;
    };
    const extremeBetween=(left,right,field,mode)=>{
      const rows=w.slice(left.index+1,right.index);
      if(!rows.length)return null;
      const values=rows.map(x=>x[field]);
      return mode==='min'?Math.min(...values):Math.max(...values);
    };
    const breakUp=(level)=>p.close<=level+0.08*atr&&c.close>level+0.06*atr;
    const breakDown=(level)=>p.close>=level-0.08*atr&&c.close<level-0.06*atr;

    // False breaks of the previous 20-bar high/low.
    const prior20=w.slice(Math.max(0,n-21),n-1);
    if(prior20.length>=15){
      const priorHigh=Math.max(...prior20.map(x=>x.high));
      const priorLow=Math.min(...prior20.map(x=>x.low));
      flags.falseBreakUp=c.high>priorHigh+0.05*atr&&c.close<priorHigh-0.02*atr;
      flags.falseBreakDown=c.low<priorLow-0.05*atr&&c.close>priorLow+0.02*atr;
    }

    // Double/triple tops and bottoms: the pattern is actionable only on a neckline cross.
    const doubleHighs=hasRepeated(highs,2,0.45*atr,36);
    if(doubleHighs){
      const neck=extremeBetween(doubleHighs[0],doubleHighs[1],'low','min');
      if(neck!=null&&doubleHighs[0].price-neck>=0.65*atr&&breakDown(neck))flags.doubleTopBreakdown=true;
    }
    const doubleLows=hasRepeated(lows,2,0.45*atr,36);
    if(doubleLows){
      const neck=extremeBetween(doubleLows[0],doubleLows[1],'high','max');
      if(neck!=null&&neck-doubleLows[0].price>=0.65*atr&&breakUp(neck))flags.doubleBottomBreakout=true;
    }
    const tripleHighs=hasRepeated(highs,3,0.60*atr,48);
    if(tripleHighs){
      const neck=extremeBetween(tripleHighs[0],tripleHighs[2],'low','min');
      if(neck!=null&&tripleHighs[0].price-neck>=0.75*atr&&breakDown(neck))flags.tripleTopBreakdown=true;
    }
    const tripleLows=hasRepeated(lows,3,0.60*atr,48);
    if(tripleLows){
      const neck=extremeBetween(tripleLows[0],tripleLows[2],'high','max');
      if(neck!=null&&neck-tripleLows[0].price>=0.75*atr&&breakUp(neck))flags.tripleBottomBreakout=true;
    }

    // Head-and-shoulders / inverse head-and-shoulders with a neckline break.
    const shoulders=highs.slice(-3);
    if(shoulders.length===3){
      const [left,head,right]=shoulders;
      const leftNeck=extremeBetween(left,head,'low','min');
      const rightNeck=extremeBetween(head,right,'low','min');
      const spacing=head.index-left.index>=3&&right.index-head.index>=3&&right.index-left.index<=48;
      if(spacing&&leftNeck!=null&&rightNeck!=null&&Math.abs(left.price-right.price)<=0.5*atr&&
        head.price-Math.max(left.price,right.price)>=0.55*atr){
        const neck=(leftNeck+rightNeck)/2;
        if(breakDown(neck))flags.headShouldersBreakdown=true;
      }
    }
    const inverseShoulders=lows.slice(-3);
    if(inverseShoulders.length===3){
      const [left,head,right]=inverseShoulders;
      const leftNeck=extremeBetween(left,head,'high','max');
      const rightNeck=extremeBetween(head,right,'high','max');
      const spacing=head.index-left.index>=3&&right.index-head.index>=3&&right.index-left.index<=48;
      if(spacing&&leftNeck!=null&&rightNeck!=null&&Math.abs(left.price-right.price)<=0.5*atr&&
        Math.min(left.price,right.price)-head.price>=0.55*atr){
        const neck=(leftNeck+rightNeck)/2;
        if(breakUp(neck))flags.inverseHeadShouldersBreakout=true;
      }
    }

    // Triangles and wedges use two confirmed swing highs and lows.
    const hp=highs.slice(-2),lp=lows.slice(-2);
    if(hp.length===2&&lp.length===2){
      const hSlope=(hp[1].price-hp[0].price)/(hp[1].index-hp[0].index);
      const lSlope=(lp[1].price-lp[0].price)/(lp[1].index-lp[0].index);
      const span=n-1-Math.min(hp[0].index,lp[0].index);
      const hMove=hSlope*span,lMove=lSlope*span;
      const upperNow=lineThrough(hp[0],hp[1],n-1),upperPrev=lineThrough(hp[0],hp[1],n-2);
      const lowerNow=lineThrough(lp[0],lp[1],n-1),lowerPrev=lineThrough(lp[0],lp[1],n-2);
      const asc=Math.abs(hMove)<=0.45*atr&&lMove>=0.35*atr;
      const desc=Math.abs(lMove)<=0.45*atr&&hMove<=-0.35*atr;
      const sym=hMove<=-0.35*atr&&lMove>=0.35*atr;
      if(asc&&c.close>upperNow+0.05*atr&&p.close<=upperPrev+0.05*atr)flags.ascendingTriangleBreakout=true;
      if(desc&&c.close<lowerNow-0.05*atr&&p.close>=lowerPrev-0.05*atr)flags.descendingTriangleBreakdown=true;
      if(sym&&c.close>upperNow+0.05*atr&&p.close<=upperPrev+0.05*atr)flags.symmetricTriangleBreakoutUp=true;
      if(sym&&c.close<lowerNow-0.05*atr&&p.close>=lowerPrev-0.05*atr)flags.symmetricTriangleBreakoutDown=true;
      if(hSlope>0&&lSlope>hSlope&&(lSlope-hSlope)*span>=0.35*atr&&c.close<lowerNow-0.05*atr&&p.close>=lowerPrev-0.05*atr)flags.risingWedgeBreakdown=true;
      if(hSlope<lSlope&&lSlope<0&&(lSlope-hSlope)*span>=0.35*atr&&c.close>upperNow+0.05*atr&&p.close<=upperPrev+0.05*atr)flags.fallingWedgeBreakout=true;
    }

    // Rectangle: repeated tests of both boundaries followed by a close outside the range.
    if(prior20.length>=15){
      const top=Math.max(...prior20.map(x=>x.high)),bottom=Math.min(...prior20.map(x=>x.low));
      const width=top-bottom;
      if(width>=0.8*atr&&width<=5.5*atr){
        const topTouches=prior20.filter(x=>x.high>=top-0.22*atr).length;
        const bottomTouches=prior20.filter(x=>x.low<=bottom+0.22*atr).length;
        if(topTouches>=2&&bottomTouches>=2){
          if(p.close<=top+0.08*atr&&c.close>top+0.06*atr)flags.rectangleBreakoutUp=true;
          if(p.close>=bottom-0.08*atr&&c.close<bottom-0.06*atr)flags.rectangleBreakoutDown=true;
        }
      }
    }

    // Retest: a confirmed close outside an earlier 20-bar range, then a return to that boundary.
    for(let j=Math.max(20,n-8);j<n-1;j++){
      const before=w.slice(j-20,j);
      if(before.length<15)continue;
      const oldHigh=Math.max(...before.map(x=>x.high)),oldLow=Math.min(...before.map(x=>x.low));
      if(w[j].close>oldHigh+0.05*atr&&c.low<=oldHigh+0.18*atr&&c.close>oldHigh+0.05*atr)flags.bullishRetest=true;
      if(w[j].close<oldLow-0.05*atr&&c.high>=oldLow-0.18*atr&&c.close<oldLow-0.05*atr)flags.bearishRetest=true;
    }

    // Clustered swing levels and rejection candles.
    const cluster=(points)=>{
      const recent=points.slice(-8);
      let best=null;
      for(const point of recent){
        const peers=recent.filter(x=>Math.abs(x.price-point.price)<=0.30*atr);
        if(peers.length>=2&&(!best||peers.length>best.count)){
          best={price:mean(peers.map(x=>x.price)),count:peers.length};
        }
      }
      return best;
    };
    const resistance=cluster(highs),support=cluster(lows);
    const body=Math.abs(c.close-c.open);
    const upperWick=c.high-Math.max(c.open,c.close);
    const lowerWick=Math.min(c.open,c.close)-c.low;
    if(resistance&&c.high>=resistance.price-0.15*atr&&c.close<=resistance.price-0.08*atr&&upperWick>=Math.max(0.12*atr,body*0.45))flags.resistanceRejected=true;
    if(support&&c.low<=support.price+0.15*atr&&c.close>=support.price+0.08*atr&&lowerWick>=Math.max(0.12*atr,body*0.45))flags.supportHeld=true;

    // Parallel channels: detect a rejection from one of the fitted channel edges.
    const channelBars=w.slice(Math.max(0,n-19),n-1);
    if(channelBars.length>=12){
      const upperReg=regressionLine(channelBars.map(x=>x.high));
      const lowerReg=regressionLine(channelBars.map(x=>x.low));
      const x=channelBars.length;
      const upper=upperReg.at(x),lower=lowerReg.at(x);
      const channelWidth=upper-lower;
      const slopeGap=Math.abs(upperReg.slope-lowerReg.slope)*(x-1);
      if(channelWidth>=0.65*atr&&channelWidth<=5*atr&&slopeGap<=0.40*atr){
        if(c.low<=lower+0.16*atr&&c.close>=lower+0.12*atr&&lowerWick>=0.12*atr)flags.bullChannelBounce=true;
        if(c.high>=upper-0.16*atr&&c.close<=upper-0.12*atr&&upperWick>=0.12*atr)flags.bearChannelBounce=true;
      }
    }

    // Flag and pennant continuation: impulse first, seven-bar consolidation second, breakout last.
    const impulseStart=n-17,impulseEnd=n-9,consolidation=w.slice(n-8,n-1);
    if(impulseStart>=0&&consolidation.length===7){
      const impulse=w[impulseEnd].close-w[impulseStart].close;
      const consHigh=Math.max(...consolidation.map(x=>x.high));
      const consLow=Math.min(...consolidation.map(x=>x.low));
      const consWidth=consHigh-consLow;
      const upperReg=regressionLine(consolidation.map(x=>x.high));
      const lowerReg=regressionLine(consolidation.map(x=>x.low));
      const upperMove=upperReg.slope*6,lowerMove=lowerReg.slope*6;
      const parallel=Math.abs(upperMove-lowerMove)<=0.45*atr;
      const compact=consWidth>=0.55*atr&&consWidth<=3.8*atr;
      const converging=upperMove<=-0.12*atr&&lowerMove>=0.12*atr&&
        (consolidation[6].high-consolidation[6].low)<=(consolidation[0].high-consolidation[0].low)-0.08*atr;
      if(compact&&impulse>=2*atr){
        if(parallel&&upperMove<=0.20*atr&&lowerMove<=0.20*atr&&(upperMove<0||lowerMove<0)&&c.close>consHigh+0.05*atr)flags.bullFlagBreakout=true;
        if(converging&&c.close>consHigh+0.05*atr)flags.bullPennantBreakout=true;
      }
      if(compact&&impulse<=-2*atr){
        if(parallel&&upperMove>=-0.20*atr&&lowerMove>=-0.20*atr&&(upperMove>0||lowerMove>0)&&c.close<consLow-0.05*atr)flags.bearFlagBreakdown=true;
        if(converging&&c.close<consLow-0.05*atr)flags.bearPennantBreakdown=true;
      }
    }

    const families={
      falseBreakout:directionFrom(flags.falseBreakDown,flags.falseBreakUp),
      levelReaction:directionFrom(flags.supportHeld,flags.resistanceRejected),
      reversal:directionFrom(flags.doubleBottomBreakout||flags.tripleBottomBreakout||flags.inverseHeadShouldersBreakout,
        flags.doubleTopBreakdown||flags.tripleTopBreakdown||flags.headShouldersBreakdown),
      triangles:directionFrom(flags.ascendingTriangleBreakout||flags.symmetricTriangleBreakoutUp||flags.fallingWedgeBreakout,
        flags.descendingTriangleBreakdown||flags.symmetricTriangleBreakoutDown||flags.risingWedgeBreakdown),
      continuation:directionFrom(flags.bullFlagBreakout||flags.bullPennantBreakout,
        flags.bearFlagBreakdown||flags.bearPennantBreakdown),
      retest:directionFrom(flags.bullishRetest,flags.bearishRetest),
      channels:directionFrom(flags.bullChannelBounce,flags.bearChannelBounce),
      rangeBreakout:directionFrom(flags.rectangleBreakoutUp,flags.rectangleBreakoutDown)
    };
    const activeDirections=Object.values(families).filter(x=>x!==0);
    families.all=activeDirections.length&&activeDirections.every(x=>x===activeDirections[0])?activeDirections[0]:0;
    const labels=[];
    const labelMap={
      falseBreakUp:'Ложный пробой сопротивления',falseBreakDown:'Ложный пробой поддержки',
      resistanceRejected:'Отбой от сопротивления',supportHeld:'Отбой от поддержки',
      doubleTopBreakdown:'Двойная вершина',doubleBottomBreakout:'Двойное дно',
      tripleTopBreakdown:'Тройная вершина',tripleBottomBreakout:'Тройное дно',
      headShouldersBreakdown:'Голова и плечи',inverseHeadShouldersBreakout:'Перевёрнутая голова и плечи',
      ascendingTriangleBreakout:'Пробой восходящего треугольника',descendingTriangleBreakdown:'Пробой нисходящего треугольника',
      symmetricTriangleBreakoutUp:'Пробой симметричного треугольника вверх',symmetricTriangleBreakoutDown:'Пробой симметричного треугольника вниз',
      risingWedgeBreakdown:'Пробой восходящего клина вниз',fallingWedgeBreakout:'Пробой нисходящего клина вверх',
      rectangleBreakoutUp:'Пробой диапазона вверх',rectangleBreakoutDown:'Пробой диапазона вниз',
      bullFlagBreakout:'Бычий флаг',bearFlagBreakdown:'Медвежий флаг',
      bullPennantBreakout:'Бычий вымпел',bearPennantBreakdown:'Медвежий вымпел',
      bullishRetest:'Бычий ретест',bearishRetest:'Медвежий ретест',
      bullChannelBounce:'Отбой от нижней границы канала',bearChannelBounce:'Отбой от верхней границы канала'
    };
    for(const [key,value] of Object.entries(flags))if(value)labels.push(labelMap[key]||key);
    return {flags,families,direction:families.all,labels,count:labels.length};
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


  // Build indicator arrays once for a full historical pass. Each indicator is causal:
  // the value at index i depends only on candles at or before i.
  function buildHigherTimeframeTrendSeries(candles, timeframeSeconds) {
    const factor = timeframeSeconds === 60 ? 5 : timeframeSeconds === 120 ? 3 : timeframeSeconds === 300 ? 3 : 4;
    const higherSeconds = timeframeSeconds * factor;
    const groups = new Map();
    for (const c of candles) {
      const key = Math.floor(c.time / higherSeconds);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const bars = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, rows]) => rows.length === factor)
      .map(([key, rows]) => ({ key, close: rows[rows.length - 1].close }));
    const closes = bars.map(x => x.close);
    const e20 = emaSeries(closes, 20);
    const out = Array(candles.length).fill(null);
    let pointer = -1;
    for (let i = 0; i < candles.length; i++) {
      const currentGroup = Math.floor(candles[i].time / higherSeconds);
      while (pointer + 1 < bars.length && bars[pointer + 1].key < currentGroup) pointer++;
      if (i + 1 < factor * 20 || pointer + 1 < 22 || e20[pointer] == null) continue;
      const slope = e20[pointer] - e20[pointer - 3];
      out[i] = {
        direction: closes[pointer] > e20[pointer] && slope > 0 ? 1 :
          closes[pointer] < e20[pointer] && slope < 0 ? -1 : 0,
        bars: pointer + 1,
        seconds: higherSeconds
      };
    }
    return out;
  }

  function buildAnalysisCache(candles, timeframeSeconds = 60) {
    const closes = candles.map(c => c.close);
    const mc = macdSeries(closes);
    const st = stochasticSeries(candles);
    return {
      e9: emaSeries(closes, 9),
      e21: emaSeries(closes, 21),
      e50: emaSeries(closes, 50),
      rs: rsiSeries(closes),
      mc,
      bb: bandsSeries(closes),
      st,
      atr: atrSeries(candles),
      adx: adxSeries(candles),
      higherTrend: buildHigherTimeframeTrendSeries(candles, timeframeSeconds)
    };
  }

  function evaluate(candles, timeframeSeconds = 60, prepared = null, indexOverride = null) {
    const i = Number.isInteger(indexOverride) ? indexOverride : candles.length - 1;
    const n = i + 1;
    if (n < 60) return { ready: false, reason: 'Для анализа нужно минимум 60 свечей', score: 0, direction: 'NONE', confidence: null };
    const closes = prepared ? null : candles.slice(0, n).map(c => c.close);
    const e9 = prepared ? prepared.e9 : emaSeries(closes, 9);
    const e21 = prepared ? prepared.e21 : emaSeries(closes, 21);
    const e50 = prepared ? prepared.e50 : emaSeries(closes, 50);
    const rs = prepared ? prepared.rs : rsiSeries(closes);
    const mc = prepared ? prepared.mc : macdSeries(closes);
    const bb = prepared ? prepared.bb : bandsSeries(closes);
    const st = prepared ? prepared.st : stochasticSeries(candles.slice(0, n));
    const atr = prepared ? prepared.atr : atrSeries(candles.slice(0, n));
    const adx = prepared ? prepared.adx : adxSeries(candles.slice(0, n));
    const c = candles[i], p = candles[i - 1];
    const pattern = candlePattern(c, p);
    const chartPatterns = detectChartPatterns(candles, i, atr[i]);
    const higherTrend = prepared ? prepared.higherTrend[i] : higherTimeframeTrend(candles.slice(0, n), timeframeSeconds);
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
    if(chartPatterns.direction!==0&&((chartPatterns.direction>0&&direction==='UP')||(chartPatterns.direction<0&&direction==='DOWN'))&&chartPatterns.labels.length){
      factors.push({value:0,label:'Графические фигуры подтверждают: '+chartPatterns.labels.slice(0,2).join(', ')});
    }
    const strength = Math.min(95, Math.round(50 + Math.abs(score) * 5));
    return {
      ready: true, direction, score, confidence: direction === 'NONE' ? null : strength,
      indicators: { ema9: e9[i], ema21: e21[i], ema50: e50[i], rsi: rs[i], macd: mc.line[i], macdSignal: mc.signal[i], macdHist: mc.hist[i], stochasticK: st.k[i], stochasticD: st.d[i], bb: b, atr: atr[i], adx: adx[i], atrPct },
      pattern, chartPatterns, higherTrend, factors,
      features: {
        chartPatternDirection: chartPatterns.direction,
        chartPatternCount: chartPatterns.count,
        falseBreakoutDirection: chartPatterns.families.falseBreakout,
        levelReactionDirection: chartPatterns.families.levelReaction,
        reversalPatternDirection: chartPatterns.families.reversal,
        trianglePatternDirection: chartPatterns.families.triangles,
        continuationPatternDirection: chartPatterns.families.continuation,
        retestDirection: chartPatterns.families.retest,
        channelReactionDirection: chartPatterns.families.channels,
        rangeBreakoutDirection: chartPatterns.families.rangeBreakout,
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

  function estimateStreakRisk(trades,horizon=100,simulations=400,blockLength=5){
    const sequence=trades.map(x=>x.tie?0:(x.win?1:-1));
    if(sequence.length<50)return null;
    const block=Math.min(blockLength,sequence.length);
    let seed=(sequence.length*9301+sequence.reduce((s,x,i)=>s+(x===-1?(i+17)*13:x===1?(i+7)*3:i),0)+49297)%233280;
    if(seed<=0)seed=1;
    const random=()=>{seed=(seed*9301+49297)%233280;return seed/233280;};
    let max3=0,max4=0,max5=0,totalMax=0;
    for(let sim=0;sim<simulations;sim++){
      let lossRun=0,maxRun=0,filled=0;
      while(filled<horizon){
        const start=Math.floor(random()*(sequence.length-block+1));
        for(let j=0;j<block&&filled<horizon;j++,filled++){
          const outcome=sequence[start+j];
          if(outcome===-1){lossRun++;maxRun=Math.max(maxRun,lossRun);}
          else lossRun=0;
        }
      }
      totalMax+=maxRun;
      if(maxRun>=3)max3++;
      if(maxRun>=4)max4++;
      if(maxRun>=5)max5++;
    }
    return {horizon,simulations,blockLength:block,pMax3:max3/simulations,pMax4:max4/simulations,pMax5:max5/simulations,meanMax:totalMax/simulations};
  }

  function backtest(candles, expirySeconds, timeframeSeconds, payoutRate = 0.9) {
    if (!Number.isFinite(expirySeconds) || !Number.isFinite(timeframeSeconds) || expirySeconds < timeframeSeconds || expirySeconds % timeframeSeconds !== 0) return { supported: false, reason: 'Для точного теста экспирация должна быть не короче таймфрейма и кратна ему.' };
    const step = expirySeconds / timeframeSeconds;
    let signals = 0, wins = 0, losses = 0, ties = 0;
    const byDirection = { UP: { signals: 0, wins: 0, losses: 0, ties: 0 }, DOWN: { signals: 0, wins: 0, losses: 0, ties: 0 } };
    const groups = {};
    const outcomes = [], nonOverlappingOutcomes = [];
    const patternFamilies=[
      {id:'all',label:'Графические фигуры · единый сигнал'},
      {id:'falseBreakout',label:'Фигуры · ложные пробои'},
      {id:'levelReaction',label:'Фигуры · поддержка/сопротивление'},
      {id:'reversal',label:'Фигуры · разворотные модели'},
      {id:'triangles',label:'Фигуры · треугольники и клинья'},
      {id:'continuation',label:'Фигуры · флаги и вымпелы'},
      {id:'retest',label:'Фигуры · ретесты'},
      {id:'channels',label:'Фигуры · каналы'},
      {id:'rangeBreakout',label:'Фигуры · пробой прямоугольника'}
    ];
    const patternOutcomes=Object.fromEntries(patternFamilies.map(x=>[x.id,[]]));
    const patternNextAllowed=Object.fromEntries(patternFamilies.map(x=>[x.id,59]));
    let nextNonOverlappingIndex = 59;
    const prepared = buildAnalysisCache(candles, timeframeSeconds);
    const addGroup = (key, result, win, tie) => {
      const g = groups[key] || (groups[key] = { signals: 0, wins: 0, losses: 0, ties: 0 });
      g.signals++;
      if (tie) g.ties++;
      else if (win) g.wins++;
      else g.losses++;
    };
    for (let i = 59; i + step < candles.length; i++) {
      // Do not simulate a fixed-minute expiry across missing historical candles.
      let continuousWindow = true;
      for (let j = i; j < i + step; j++) {
        if (Number(candles[j + 1].time) - Number(candles[j].time) !== timeframeSeconds) {
          continuousWindow = false;
          break;
        }
      }
      if (!continuousWindow) continue;

      const result = evaluate(candles, timeframeSeconds, prepared, i);
      const entry = candles[i + 1].open, exit = candles[i + step].close;
      const tie = Math.abs(exit - entry) < 1e-12;
      const makeOutcome = direction => ({
        direction, adx:result.indicators?.adx, win:!tie&&(direction==='UP'?exit>entry:exit<entry), tie,
        entryIndex:i+1, score:result.score, features:result.features,
        chartPatterns:result.chartPatterns, higherDirection:result.features?.htfDirection??0
      });
      // Each chart-pattern family is tested as a separate non-overlapping UP/DOWN stream.
      for(const family of patternFamilies){
        const direction=family.id==='all'?result.chartPatterns?.direction:(result.chartPatterns?.families?.[family.id]??0);
        if(direction&&i>=patternNextAllowed[family.id]){
          patternOutcomes[family.id].push(makeOutcome(direction>0?'UP':'DOWN'));
          patternNextAllowed[family.id]=i+step;
        }
      }
      if (result.direction === 'NONE') continue;
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
    const splitAt = Math.max(1, Math.floor(candles.length * 0.7));
    const summarizeModel = rows => {
      const w = rows.filter(x=>x.win && !x.tie).length;
      const l = rows.filter(x=>!x.win && !x.tie).length;
      const ties = rows.filter(x=>x.tie).length;
      const decided = w + l;
      const riskStats = streakStats(rows);
      return { signals: rows.length, wins:w, losses:l, ties, winRate: decided ? w/decided*100 : null,
        expectedValue: decided ? (w*payoutRate-l)/decided : null, maxLossStreak:riskStats.maxLossStreak,
        streaks2Plus:riskStats.streaks2Plus,streaks3Plus:riskStats.streaks3Plus,
        streaks4Plus:riskStats.streaks4Plus,streaks5Plus:riskStats.streaks5Plus,
        risk100:estimateStreakRisk(rows) };
    };
    const models = modelDefinitions.map(def => {
      const selected = outcomes.filter(def.test);
      const train = selected.filter(x=>x.entryIndex < splitAt);
      const test = selected.filter(x=>x.entryIndex >= splitAt);
      return { id:def.id, label:def.label, full:summarizeModel(selected), train:summarizeModel(train), test:summarizeModel(test),
        status: train.length >= 50 && test.length >= 30 ? 'tested' : 'small-sample' };
    });
    const indicatorModels = modelDefinitions.map(def => {
      const selected = outcomes.filter(def.test);
      const train = selected.filter(x=>x.entryIndex < splitAt);
      const test = selected.filter(x=>x.entryIndex >= splitAt);
      return { id:def.id, label:def.label, full:summarizeModel(selected), train:summarizeModel(train), test:summarizeModel(test),
        source:'indicators',status: train.length >= 50 && test.length >= 30 ? 'tested' : 'small-sample' };
    });
    const chartPatternModels = patternFamilies.map(def=>{
      const selected=patternOutcomes[def.id];
      const train=selected.filter(x=>x.entryIndex<splitAt);
      const test=selected.filter(x=>x.entryIndex>=splitAt);
      return {id:'pattern_'+def.id,label:def.label,full:summarizeModel(selected),train:summarizeModel(train),
        test:summarizeModel(test),source:'chart-pattern',status:train.length>=50&&test.length>=30?'tested':'small-sample'};
    });
    const models=[...indicatorModels,...chartPatternModels];
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

  root.PocketAnalysis = { evaluate, backtest, detectChartPatterns, streakStats, estimateStreakRisk, emaSeries, rsiSeries, macdSeries, bandsSeries, stochasticSeries, atrSeries, adxSeries };
})(window);
