// live_connector.js — connect to Binance WebSocket kline stream, seed via REST klines
(function(){
  let ws = null; let candles = [];
  const outEl = document.getElementById('jsonOut');
  // signal panel elements (may not all exist depending on UI)
  const sigSideEl = document.getElementById('signalSide');
  const sigConfidenceEl = document.getElementById('signalConfidence');
  const sigEntryEl = document.getElementById('signalEntry');
  const sigStopEl = document.getElementById('signalStop');
  const sigTpEl = document.getElementById('signalTP');
  const sigReasonsEl = document.getElementById('signalReasons');
  const logEl = document.getElementById('logOut');

  // Chart setup using Lightweight Charts
  const chartContainer = document.getElementById('chart');
  const chart = LightweightCharts.createChart(chartContainer, {layout:{background:'#071428',textColor:'#dbe9ff'},width:chartContainer.clientWidth,height:480,rightPriceScale:{borderColor:'rgba(255,255,255,0.06)'},timeScale:{borderColor:'rgba(255,255,255,0.06)'}});
  const candleSeries = chart.addCandlestickSeries({upColor:'#0f6e56',downColor:'#993C1D',borderVisible:false});
  // overlay holders
  let overlaySeries = [];
  function clearOverlays(){
    try{
      // clear markers
      candleSeries.setMarkers([]);
      // remove extra series
      overlaySeries.forEach(s=>{ try{ chart.removeSeries(s); }catch(e){} });
      overlaySeries = [];
    }catch(e){ console.error('clearOverlays',e); }
  }

  function log(...args){ if(logEl) logEl.textContent = new Date().toISOString() + '  ' + args.join(' '); }

  function mapKlineToCandle(k){
    // map to Lightweight Charts format {time, open, high, low, close}
    const time = Math.floor(k.t/1000);
    return {time,open:parseFloat(k.o),high:parseFloat(k.h),low:parseFloat(k.l),close:parseFloat(k.c),v:parseFloat(k.v)};
  }

  async function seedCandles(symbol, interval, limit=200){
    const qs = `?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const url = 'https://api.binance.com/api/v3/klines' + qs;
    const res = await fetch(url);
    const data = await res.json();
    candles = data.map(d=>({t:d[0],o:parseFloat(d[1]),h:parseFloat(d[2]),l:parseFloat(d[3]),c:parseFloat(d[4]),v:parseFloat(d[5])}));
    // feed to chart
    const seriesData = candles.map(d=>({time:Math.floor(d.t/1000),open:d.o,high:d.h,low:d.l,close:d.c}));
    candleSeries.setData(seriesData);
    chart.timeScale().fitContent();
    return candles;
  }

  function start(symbol='BTCUSDT', interval='1m'){
    if(ws) stop();
    // ensure UI buttons reflect running state
    try{ document.getElementById('startLive').disabled = true; document.getElementById('stopLive').disabled = false; }catch(e){}
    log('Seeding',symbol,interval);
    seedCandles(symbol, interval).then(c=>{
      renderAnalysis(c);
      const stream = `${symbol.toLowerCase()}@kline_${interval}`;
      const url = `wss://stream.binance.com:9443/ws/${stream}`;
      ws = new WebSocket(url);
      ws.addEventListener('message', ev=>{
        try{
          const msg = JSON.parse(ev.data);
          if(!msg.k) return;
          const k = msg.k; // kline object
          const candle = mapKlineToCandle(k);
          // update last candle while not closed
          if(candles.length===0) candles.push({t:candle.time*1000,o:candle.open,h:candle.high,l:candle.low,c:candle.close,v:candle.v});
          else candles[candles.length-1] = {t:candle.time*1000,o:candle.open,h:candle.high,l:candle.low,c:candle.close,v:candle.v};

          // update chart: replace last bar
          candleSeries.update({time:candle.time,open:candle.open,high:candle.high,low:candle.low,close:candle.close});

          if(k.x){ // kline closed
            // append a new candle placeholder on next message (no explicit action needed)
          }
          renderAnalysis(candles);
        }catch(e){ console.error(e); log('ws message err',e.message); }
      });
      ws.addEventListener('open', ()=>{ log('ws open',url); });
      ws.addEventListener('close', ()=>{ log('ws closed'); });
    }).catch(err=>{console.error('seed error',err); log('seed error',err.message||err);});
  }

  function isRunning(){ return !!ws; }

  function stop(){ if(ws){ ws.close(); ws=null; log('stopped'); }}

  function renderAnalysis(c){
    try{
      const decision = window.TradingEngines.analyzeGoldPilot({
        candles:c,
        timeframes:{execution:c},
        account:{balance:1000,riskPct:1,minLot:0.01},
        market:{spread:0}
      });
      const out = decision.rawAnalysis;
      if(outEl) outEl.textContent = JSON.stringify(decision,null,2);
      // populate signal panel fields if present
      try{
        const plan = decision.tradePlan || {};
        if(sigSideEl) sigSideEl.innerText = decision.tradeStatus || 'WAIT';
        if(sigConfidenceEl) sigConfidenceEl.innerText = 'Bias confidence: ' + (decision.bias && decision.bias.confidence ? decision.bias.confidence + '%' : '-');
        if(sigEntryEl) sigEntryEl.innerText = plan.entryZone ? plan.entryZone.join(' - ') : '-';
        if(sigStopEl) sigStopEl.innerText = plan.stopLoss == null ? '-' : plan.stopLoss;
        if(sigTpEl) sigTpEl.innerText = plan.takeProfit ? `${plan.takeProfit.tp1} / ${plan.takeProfit.tp2}` : '-';
        const rrEl = document.getElementById('rrVal');
        if(rrEl) rrEl.innerText = plan.riskReward ? 'R:R ' + plan.riskReward : 'R:R -';
        const biasEl = document.getElementById('biasMeter');
        if(biasEl) biasEl.innerText = `${decision.bias.bias} | ${decision.regime.regime}`;
        const sweepsEl = document.getElementById('recentSweeps');
        if(sweepsEl) sweepsEl.innerText = decision.liquidityMap.sweeps.length ? JSON.stringify(decision.liquidityMap.sweeps.slice(-3)) : '(no sweeps)';
        if(sigReasonsEl) sigReasonsEl.innerText = (decision.reason || []).concat(decision.nextConditionNeeded || []).join(' | ') || 'No reasons yet';
      }catch(e){ console.warn('populate signal panel failed', e); }
      // render overlays (swings, BOS, zones, liquidity levels)
      renderOverlays(out, c);
    }catch(e){ console.error(e); log('analysis error',e.message); }
  }

  function renderOverlays(out, candles){
    try{
      // respect UI toggle
      const show = (document.getElementById('showOverlays')||{}).checked !== false;
      clearOverlays();
      if(!show) return;
      if(!out || !candles || candles.length===0) return;
      const firstTime = Math.floor(candles[0].t/1000);
      const lastTime = Math.floor(candles[candles.length-1].t/1000);

      // Debug: log counts (also present in #jsonOut)
      try{ console.log('renderOverlays', {swings: (out.market&&out.market.swings||[]).length, zones:(out.zones&&out.zones.zones||[]).length, levels:(out.liquidity&&out.liquidity.notableLevels||[]).length}); }catch(e){}

      // 1) Swings as markers
      const swings = out.market && out.market.swings || [];
      const markers = swings.map(s=>{
        const c = candles[s.i];
        return {
          time: Math.floor(c.t/1000),
          position: s.type==='H' ? 'aboveBar' : 'belowBar',
          color: s.type==='H' ? '#FF6B6B' : '#3DDC84',
          shape: s.type==='H' ? 'arrowDown' : 'arrowUp',
          text: s.type
        };
      });
      candleSeries.setMarkers(markers);

      // 2) BOS line
      if(out.market && out.market.bos){
        const price = out.market.bos.price;
        const ls = chart.addLineSeries({color:'#FFB020',lineWidth:1});
        ls.setData([{time:firstTime,value:price},{time:lastTime,value:price}]);
        overlaySeries.push(ls);
      }

      // 3) Zones: draw zone high/low as thin shaded lines (two lines per zone)
      const zones = out.zones && out.zones.zones || [];
      zones.forEach((z, idx)=>{
        const col = z.dir==='demand' ? 'rgba(0,200,118,0.12)' : 'rgba(255,92,92,0.12)';
        const lineCol = z.dir==='demand' ? 'rgba(0,200,118,0.9)' : 'rgba(255,92,92,0.9)';
        const top = chart.addLineSeries({color:lineCol,lineWidth:1}); top.setData([{time:firstTime,value:z.high},{time:lastTime,value:z.high}]); overlaySeries.push(top);
        const bot = chart.addLineSeries({color:lineCol,lineWidth:1}); bot.setData([{time:firstTime,value:z.low},{time:lastTime,value:z.low}]); overlaySeries.push(bot);
        // origin marker
        const o = candles[z.origin];
        if(o) overlaySeries.push( (function(){ const ms = chart.addLineSeries({color:lineCol,lineWidth:0}); ms.setData([{time:Math.floor(o.t/1000),value:(z.high+z.low)/2}]); return ms; })() );
      });

      // 4) Liquidity notable levels as dashed lines
      const levels = out.liquidity && out.liquidity.notableLevels || [];
      levels.forEach(l=>{
        const ls = chart.addLineSeries({color:'rgba(255,200,20,0.6)',lineWidth:1});
        ls.setData([{time:firstTime,value:l.price},{time:lastTime,value:l.price}]);
        overlaySeries.push(ls);
      });

      // If nothing was drawn (no swings/zones/levels) draw a visible test overlay so users can confirm overlays render
      const drawnCount = markers.length + (zones.length||0) + (levels.length||0) + (out.market && out.market.bos?1:0);
      if(drawnCount === 0){
        try{
          console.log('No overlays found — drawing test overlay');
          const lastC = candles[candles.length-1];
          // test horizontal line at last close
          const testLine = chart.addLineSeries({color:'rgba(255,0,0,0.95)',lineWidth:2});
          testLine.setData([{time:firstTime,value:lastC.c},{time:lastTime,value:lastC.c}]);
          overlaySeries.push(testLine);
          // add a visible marker on last candle
          const testMarker = [{time:Math.floor(lastC.t/1000), position:'aboveBar', color:'#FF0000', shape:'circle', text:'TEST'}];
          candleSeries.setMarkers(testMarker);
        }catch(e){ console.error('test overlay err',e); }
      }

    }catch(e){ console.error('renderOverlays err',e); }
  }

  // wire UI
  document.getElementById('startLive').addEventListener('click', ()=>{
    const symbol = document.getElementById('symbol').value.trim() || 'BTCUSDT';
    const interval = document.getElementById('interval').value || '1m';
    document.getElementById('startLive').disabled = true;
    document.getElementById('stopLive').disabled = false;
    start(symbol, interval);
  });
  document.getElementById('stopLive').addEventListener('click', ()=>{
    stop();
    document.getElementById('startLive').disabled = false;
    document.getElementById('stopLive').disabled = true;
  });

  // Auto-restart when symbol or interval change while running
  const symbolEl = document.getElementById('symbol');
  const intervalEl = document.getElementById('interval');
  function handleAutoRestart(){
    try{
      if(isRunning()){
        const s = symbolEl.value.trim() || 'BTCUSDT';
        const i = intervalEl.value || '1m';
        log('Auto-restart due to change',s,i);
        // restart with new params
        start(s,i);
      }
    }catch(e){ console.error(e); }
  }
  symbolEl.addEventListener('change', handleAutoRestart);
  intervalEl.addEventListener('change', handleAutoRestart);

  // resize handling
  window.addEventListener('resize', ()=>{ chart.applyOptions({width:chartContainer.clientWidth}); });

  window.LiveConnector = {start,stop};
  // Auto-start on page load using selected symbol/interval
  try{
    const s = symbolEl ? symbolEl.value.trim() : (document.getElementById('symbol')||{}).value || 'BTCUSDT';
    const i = intervalEl ? intervalEl.value : (document.getElementById('interval')||{}).value || '1m';
    if(s && i){
      log('Auto-starting on load', s, i);
      start(s,i);
    }
  }catch(e){ console.error('auto-start err',e); }

})();
