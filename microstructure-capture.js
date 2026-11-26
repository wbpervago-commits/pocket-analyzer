/* One-second Pocket Option quote capture. Quote direction is only a proxy, not true order flow. */
(function(root){
  'use strict';
  const RETENTION_DAYS=7, DAY=86400, DB='PocketAnalyzerMicrostructure', STORE='seconds';

  function createAggregator(symbol){
    return {symbol:String(symbol||''),current:null,lastPrice:null,lastStamp:-Infinity};
  }
  function moveOf(price,previous){
    if(!Number.isFinite(previous))return 0;
    return price>previous?1:price<previous?-1:0;
  }
  function newBar(symbol,second,price,previous){
    const move=moveOf(price,previous);
    return {id:symbol+'|'+second,symbol,second,open:price,high:price,low:price,close:price,
      quotes:1,upMoves:move>0?1:0,downMoves:move<0?1:0,flatMoves:move===0&&Number.isFinite(previous)?1:0};
  }
  function ingestQuote(state,symbol,stamp,price){
    const name=String(symbol||''),time=Number(stamp),value=Number(price);
    if(!state||name!==state.symbol||!name||!Number.isFinite(time)||time<=0||!Number.isFinite(value)||value<=0)
      return {accepted:false,reason:'invalid-quote',completed:null,move:0};
    if(time<state.lastStamp)return {accepted:false,reason:'out-of-order-quote',completed:null,move:0};
    const second=Math.floor(time),previous=state.lastPrice,move=moveOf(value,previous);
    let completed=null;
    if(!state.current)state.current=newBar(name,second,value,previous);
    else if(second<state.current.second)return {accepted:false,reason:'older-second',completed:null,move:0};
    else if(second>state.current.second){
      completed={...state.current};
      state.current=newBar(name,second,value,previous);
    }else{
      const b=state.current;b.high=Math.max(b.high,value);b.low=Math.min(b.low,value);b.close=value;b.quotes++;
      if(move>0)b.upMoves++;else if(move<0)b.downMoves++;else if(Number.isFinite(previous))b.flatMoves++;
    }
    state.lastPrice=value;state.lastStamp=time;
    return {accepted:true,reason:'accepted',completed,move};
  }

  function create(options){
    const onUpdate=typeof options?.onUpdate==='function'?options.onUpdate:()=>{};
    let symbol='',state=createAggregator(''),dbPromise=null,pending=[],flushPromise=null;
    let archiveBars=0,sessionQuotes=0,sessionBars=0,up=0,down=0,flat=0;
    let started=Date.now(),lastPublish=0,lastPrune=0;
    function publish(force=false){
      const now=Date.now();if(!force&&now-lastPublish<900)return;lastPublish=now;
      const elapsed=Math.max(1,(now-started)/1000);
      const stats={symbol,active:sessionQuotes>0,archiveBars:archiveBars+pending.length,sessionQuotes,sessionBars,
        quotesPerSecond:sessionQuotes/elapsed,upMoves:up,downMoves:down,flatMoves:flat,
        imbalance:up+down?(up-down)/(up+down):null,retentionDays:RETENTION_DAYS};
      try{onUpdate(stats);}catch(_){}
    }
    function openDb(){
      if(!root.indexedDB)return Promise.resolve(null);
      if(dbPromise)return dbPromise;
      dbPromise=new Promise(resolve=>{
        let req;try{req=root.indexedDB.open(DB,1);}catch(_){resolve(null);return;}
        req.onupgradeneeded=()=>{
          const db=req.result;
          if(!db.objectStoreNames.contains(STORE)){
            const s=db.createObjectStore(STORE,{keyPath:'id'});
            s.createIndex('bySymbolSecond',['symbol','second'],{unique:true});
            s.createIndex('bySecond','second',{unique:false});
          }
        };
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);req.onblocked=()=>resolve(null);
      });return dbPromise;
    }
    async function countCached(name){
      const db=await openDb();if(!db||!root.IDBKeyRange||!name)return 0;
      const now=Math.floor(Date.now()/1000),from=now-RETENTION_DAYS*DAY;
      return new Promise(resolve=>{
        try{const req=db.transaction(STORE,'readonly').objectStore(STORE).index('bySymbolSecond')
          .count(root.IDBKeyRange.bound([name,from],[name,now]));
          req.onsuccess=()=>resolve(Number(req.result)||0);req.onerror=()=>resolve(0);
        }catch(_){resolve(0);}
      });
    }
    async function prune(){
      const now=Date.now();if(now-lastPrune<3600000)return;lastPrune=now;
      const db=await openDb();if(!db||!root.IDBKeyRange)return;
      const cutoff=Math.floor(now/1000)-RETENTION_DAYS*DAY;
      await new Promise(resolve=>{
        try{
          const tx=db.transaction(STORE,'readwrite'),req=tx.objectStore(STORE).index('bySecond')
            .openCursor(root.IDBKeyRange.upperBound(cutoff));
          req.onsuccess=()=>{const cursor=req.result;if(cursor){cursor.delete();cursor.continue();}};
          tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve;
        }catch(_){resolve();}
      });
    }
    async function flush(){
      if(flushPromise)return flushPromise;if(!pending.length)return true;
      const batch=pending;pending=[];
      flushPromise=(async()=>{
        const db=await openDb();
        if(!db){pending=batch.concat(pending).slice(-10000);return false;}
        const ok=await new Promise(resolve=>{
          let done=false;const finish=v=>{if(!done){done=true;resolve(v);}};
          try{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
            batch.forEach(row=>store.put(row));tx.oncomplete=()=>finish(true);tx.onerror=()=>finish(false);tx.onabort=()=>finish(false);
          }catch(_){finish(false);}
        });
        if(ok)archiveBars+=batch.length;else pending=batch.concat(pending).slice(-10000);
        publish(true);return ok;
      })();
      try{return await flushPromise;}finally{flushPromise=null;}
    }
    async function readLastHours(name,hours){
      await flush();const db=await openDb();if(!db||!root.IDBKeyRange||!name)return [];
      const now=Math.floor(Date.now()/1000),from=now-Math.max(1,Number(hours)||24)*3600;
      return new Promise(resolve=>{
        try{const req=db.transaction(STORE,'readonly').objectStore(STORE).index('bySymbolSecond')
          .getAll(root.IDBKeyRange.bound([name,from],[name,now]));
          req.onsuccess=()=>resolve(Array.isArray(req.result)?req.result:[]);req.onerror=()=>resolve([]);
        }catch(_){resolve([]);}
      });
    }
    async function setSymbol(next){
      const name=String(next||'');if(name===symbol){publish(true);return;}
      await flush();symbol=name;state=createAggregator(symbol);
      sessionQuotes=sessionBars=up=down=flat=0;started=Date.now();
      archiveBars=await countCached(symbol);await prune();publish(true);
    }
    function onQuote(name,stamp,price){
      if(String(name||'')!==symbol)return false;
      const result=ingestQuote(state,name,stamp,price);if(!result.accepted)return false;
      sessionQuotes++;if(result.move>0)up++;else if(result.move<0)down++;else flat++;
      if(result.completed){pending.push(result.completed);sessionBars++;}
      if(pending.length>=20)void flush();publish();return true;
    }
    const timer=root.setInterval?root.setInterval(()=>{void flush();void prune();publish();},10000):null;
    if(root.addEventListener)root.addEventListener('pagehide',()=>{void flush();});
    return {
      setSymbol,onQuote,flush,readLastHours,
      exportLastHours:async hours=>({
        schema:'PocketAnalyzerMicrostructure.v1',exportedAt:new Date().toISOString(),symbol,
        period:'1 second',retentionDays:RETENTION_DAYS,source:'Pocket Option Quote Bridge updateStream',
        fields:{quotes:'quote messages in second',upMoves:'upward quote changes',downMoves:'downward quote changes',
          flatMoves:'unchanged quote messages'},
        limitation:'Single-price quote stream only; not traded volume, bid/ask depth, or true order flow.',
        records:await readLastHours(symbol,hours||24)
      }),
      close:()=>{if(timer!==null&&root.clearInterval)root.clearInterval(timer);void flush();}
    };
  }
  const api={retentionDays:RETENTION_DAYS,createAggregator,ingestQuote,create};
  root.PocketMicroCapture=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
