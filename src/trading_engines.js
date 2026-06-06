// Lightweight trading engines plus GoldPilot AI decision layer.
(function(){
  const CONFIG = {
    swingLeft: 3,
    swingRight: 2,
    swingTolPct: 0.001, // price tolerance for break confirmation
    minSwingsForTrend: 3,
    minRiskReward: 2,
    defaultRiskPct: 1,
  };

  function sma(arr, n){
    if(!arr || arr.length===0) return 0;
    const slice = arr.slice(-n);
    return slice.reduce((s,v)=>s+v,0)/slice.length;
  }

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function round(v, digits=2){
    if(v == null || !isFinite(v)) return null;
    const m = Math.pow(10, digits);
    return Math.round(v * m) / m;
  }

  function priceDigits(price){
    const p = Math.abs(Number(price) || 0);
    if(p >= 1000) return 2;
    if(p >= 100) return 3;
    if(p >= 1) return 4;
    if(p >= 0.1) return 5;
    if(p >= 0.01) return 6;
    return 8;
  }

  function roundNumberStep(price){
    const p = Math.abs(Number(price) || 0);
    if(p >= 10000) return 1000;
    if(p >= 1000) return 50;
    if(p >= 100) return 10;
    if(p >= 10) return 1;
    if(p >= 1) return 0.1;
    if(p >= 0.1) return 0.01;
    if(p >= 0.01) return 0.001;
    return 0.0001;
  }

  function candleRange(c){ return Math.max(0, (c.h || 0) - (c.l || 0)); }
  function candleBody(c){ return Math.abs((c.c || 0) - (c.o || 0)); }

  function calculateAtr(candles, period=14){
    if(!candles || candles.length < 2) return 0;
    const trs = [];
    for(let i=1;i<candles.length;i++){
      const cur = candles[i], prev = candles[i-1];
      trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
    }
    return sma(trs, Math.min(period, trs.length));
  }

  // improved swing detection using left/right window (fractal-like)
  // fractal swing finder with tunable left/right window
  function findSwings(candles, left=CONFIG.swingLeft, right=CONFIG.swingRight){
    const swings = [];
    for(let i=left;i<candles.length-right;i++){
      let isHigh = true, isLow = true;
      for(let j=1;j<=left;j++){
        if(candles[i].h <= candles[i-j].h) isHigh = false;
        if(candles[i].l >= candles[i-j].l) isLow = false;
      }
      for(let j=1;j<=right;j++){
        if(candles[i].h <= candles[i+j].h) isHigh = false;
        if(candles[i].l >= candles[i+j].l) isLow = false;
      }
      if(isHigh) swings.push({type:'H',i,price:candles[i].h});
      else if(isLow) swings.push({type:'L',i,price:candles[i].l});
    }
    return swings;
  }

  function detectMarketStructure(candles){
    const swings = findSwings(candles, CONFIG.swingLeft, CONFIG.swingRight);
    const res = {swings};
    if(!swings || swings.length < CONFIG.minSwingsForTrend){ res.trend='unknown'; res.bos=null; res.choch=null; return res; }

    swings.sort((a,b)=>a.i-b.i);
    const lookback = Math.min(8, swings.length);
    const last = swings.slice(-lookback);

    // Determine trend by comparing sequences of highs and lows
    const highs = last.filter(s=>s.type==='H').map(s=>s.price);
    const lows = last.filter(s=>s.type==='L').map(s=>s.price);
    let upScore=0, downScore=0;
    for(let k=1;k<highs.length;k++) highs[k] > highs[k-1] ? upScore++ : downScore++;
    for(let k=1;k<lows.length;k++) lows[k] > lows[k-1] ? upScore++ : downScore++;
    if(upScore > downScore) res.trend='up';
    else if(downScore > upScore) res.trend='down';
    else res.trend='ranging';

    // Structural extremes
    const structuralHighObj = swings.filter(s=>s.type==='H').reduce((m,s)=> m.price> (m.price||-Infinity)? m : s, {price:-Infinity});
    const structuralLowObj = swings.filter(s=>s.type==='L').reduce((m,s)=> m.price< (m.price||Infinity)? m : s, {price:Infinity});
    const structuralHigh = structuralHighObj.price === -Infinity ? null : structuralHighObj.price;
    const structuralHighIdx = structuralHighObj.i || null;
    const structuralLow = structuralLowObj.price === Infinity ? null : structuralLowObj.price;
    const structuralLowIdx = structuralLowObj.i || null;

    // BOS: require close beyond structural extreme by small tolerance
    const lastClose = candles[candles.length-1].c;
    res.bos = null;
    const tol = CONFIG.swingTolPct;
    if(structuralHigh !== null && lastClose > structuralHigh * (1 + tol)) res.bos = {direction:'bullish', price: structuralHigh, idx: structuralHighIdx};
    else if(structuralLow !== null && lastClose < structuralLow * (1 - tol)) res.bos = {direction:'bearish', price: structuralLow, idx: structuralLowIdx};

    // CHoCH: BOS against previous trend
    res.choch = null;
    if(res.bos){
      if(res.trend==='up' && res.bos.direction==='bearish') res.choch = true;
      else if(res.trend==='down' && res.bos.direction==='bullish') res.choch = true;
      else res.choch = false;
    }

    // Label swing transitions (HH/HL/LH/LL) using adjacent same-type swings
    res.structure = [];
    for(let i=1;i<swings.length;i++){
      const prev = swings[i-1]; const cur = swings[i];
      if(prev.type===cur.type){
        if(cur.type==='H') res.structure.push({i:cur.i, label: cur.price > prev.price ? 'HH' : 'LH', price:cur.price});
        if(cur.type==='L') res.structure.push({i:cur.i, label: cur.price > prev.price ? 'HL' : 'LL', price:cur.price});
      }
    }

    // annotate extra metadata
    res.structuralHigh = structuralHigh; res.structuralHighIdx = structuralHighIdx;
    res.structuralLow = structuralLow; res.structuralLowIdx = structuralLowIdx;
    res.lastSwing = swings[swings.length-1];
    return res;
  }

  function detectLiquidity(candles){
    const res={equalHighs:[],equalLows:[],stopHunts:[],fakeBreakouts:[],clusters:[],notableLevels:[],sweepCandidates:[],summary:{}};
    if(!candles || candles.length<2) return res;
    const tolPct = 0.003; // 0.3%

    // clustering highs
    const highMap = new Map();
    for(let i=0;i<candles.length;i++){
      const p = candles[i].h;
      let foundKey = null;
      for(const k of highMap.keys()){
        if(Math.abs(p - k)/k < tolPct){ foundKey = k; break; }
      }
      if(foundKey===null) highMap.set(p,[i]); else highMap.get(foundKey).push(i);
    }
    for(const [k,idxs] of highMap) if(idxs.length>1) res.clusters.push({type:'high',price:k,idxs});

    // clustering lows
    const lowMap = new Map();
    for(let i=0;i<candles.length;i++){
      const p = candles[i].l;
      let foundKey = null;
      for(const k of lowMap.keys()){
        if(Math.abs(p - k)/k < tolPct){ foundKey = k; break; }
      }
      if(foundKey===null) lowMap.set(p,[i]); else lowMap.get(foundKey).push(i);
    }
    for(const [k,idxs] of lowMap) if(idxs.length>1) res.clusters.push({type:'low',price:k,idxs});

    // structural highs/lows
    const swings = findSwings(candles,2,2);
    const structuralHigh = swings.filter(s=>s.type==='H').reduce((m,s)=>Math.max(m,s.price), -Infinity);
    const structuralLow = swings.filter(s=>s.type==='L').reduce((m,s)=>Math.min(m,s.price), Infinity);

    for(let i=1;i<candles.length;i++){
      const cur = candles[i]; const prev = candles[i-1];
      if(cur.h > prev.h && cur.c <= prev.h) res.fakeBreakouts.push({i,direction:'fake-long',peak:cur.h,prevHigh:prev.h});
      if(cur.l < prev.l && cur.c >= prev.l) res.fakeBreakouts.push({i,direction:'fake-short',peak:cur.l,prevLow:prev.l});

      const upperWick = cur.h - Math.max(cur.c, cur.o);
      const lowerWick = Math.min(cur.c, cur.o) - cur.l;
      if(structuralHigh !== -Infinity && cur.h > structuralHigh && upperWick > (cur.h-cur.l)*0.25 && cur.c < structuralHigh){
        res.stopHunts.push({i,direction:'long-sweep',peak:cur.h,structuralHigh,wick:upperWick});
        res.sweepCandidates.push({i,dir:'long',price:cur.h,wick:upperWick});
      }
      if(structuralLow !== Infinity && cur.l < structuralLow && lowerWick > (cur.h-cur.l)*0.25 && cur.c > structuralLow){
        res.stopHunts.push({i,direction:'short-sweep',peak:cur.l,structuralLow,wick:lowerWick});
        res.sweepCandidates.push({i,dir:'short',price:cur.l,wick:lowerWick});
      }
    }

    for(const c of res.clusters){ if(c.type==='high') res.equalHighs.push({price:c.price,idxs:c.idxs}); else res.equalLows.push({price:c.price,idxs:c.idxs}); }

    // notable levels
    for(const cl of res.clusters){
      const idxs = cl.idxs;
      const prices = idxs.map(i=> cl.type==='high' ? candles[i].h : candles[i].l);
      const avgPrice = prices.reduce((s,v)=>s+v,0)/prices.length;
      const avgVol = idxs.map(i=>candles[i].v||0).reduce((s,v)=>s+v,0)/idxs.length;
      const proxHigh = Math.abs(avgPrice - structuralHigh)/ (structuralHigh||1);
      const proxLow = Math.abs(avgPrice - structuralLow)/ (structuralLow||1);
      let role = 'neutral';
      if(cl.type==='high' && proxHigh < 0.02) role = 'resistance';
      if(cl.type==='low' && proxLow < 0.02) role = 'support';
      res.notableLevels.push({price:avgPrice,type:cl.type,role,count:idxs.length,avgVol,idxs});
    }

    res.summary = {
      clusters: res.clusters.length,
      equalHighs: res.equalHighs.length,
      equalLows: res.equalLows.length,
      stopHunts: res.stopHunts.length,
      fakeBreakouts: res.fakeBreakouts.length,
      sweepCandidates: res.sweepCandidates.length
    };

    return res;
  }

  function detectZones(candles){
    const res={impulses:[],zones:[],revisits:[],summary:{}};
    if(!candles || candles.length===0) return res;
    const bodies = candles.map(c=>Math.abs(c.c - c.o));
    const avgBody = sma(bodies, Math.min(20,candles.length)) || 0;
    const impMult = 2.0;

    // detect impulses and create raw zones
    for(let i=0;i<candles.length;i++){
      const c = candles[i]; const body = Math.abs(c.c - c.o);
      if(body > avgBody * impMult){
        const dir = c.c > c.o ? 'up' : 'down';
        const impulse = {origin:i,dir,body,open:c.o,close:c.c,high:c.h,low:c.l,vol:c.v||0};
        res.impulses.push(impulse);

        const range = c.h - c.l || Math.max(0.0001, Math.abs(c.c-c.o));
        const pad = range * 0.18;
        let zoneHigh, zoneLow, kind;
        if(dir==='up'){
          zoneHigh = Math.min(c.o,c.c) + pad;
          zoneLow = Math.min(c.o,c.c) - range * 0.35;
          kind = 'demand';
        } else {
          zoneHigh = Math.max(c.o,c.c) + range * 0.35;
          zoneLow = Math.max(c.o,c.c) - pad;
          kind = 'supply';
        }
        res.zones.push({origin:i,high:zoneHigh,low:zoneLow,dir:kind,impulse,createdAt:i});
      }
    }

    // merge overlapping zones
    res.zones.sort((a,b)=>a.low - b.low);
    const merged = [];
    for(const z of res.zones){
      if(merged.length===0){ merged.push(Object.assign({},z, {touches:0,lastTouched:null,strength: (z.impulse.body||0)* (z.impulse.vol||1)})); continue; }
      const prev = merged[merged.length-1];
      const overlap = Math.min(prev.high, z.high) - Math.max(prev.low, z.low);
      const smallerSize = Math.min(prev.high - prev.low, z.high - z.low);
      if(overlap > 0 && overlap > smallerSize * 0.1){
        prev.high = Math.max(prev.high, z.high);
        prev.low = Math.min(prev.low, z.low);
        prev.impulse = prev.impulse.body > z.impulse.body ? prev.impulse : z.impulse;
        prev.createdAt = Math.min(prev.createdAt, z.createdAt);
        prev.strength = (prev.strength||0) + (z.impulse.body||0) * (z.impulse.vol||1);
      } else merged.push(Object.assign({},z, {touches:0,lastTouched:null,strength: (z.impulse.body||0)* (z.impulse.vol||1)}));
    }

    // detect revisits and score zones
    res.revisits = [];
    for(const z of merged){
      for(let j=z.origin+1;j<candles.length;j++){
        const c = candles[j];
        if(c.h >= z.low && c.l <= z.high){
          z.touches = (z.touches||0) + 1;
          z.lastTouched = j;
          res.revisits.push({zone:z,at:j});
        }
      }
      z.age = Math.max(0, candles.length - 1 - z.createdAt);
      z.score = Math.round((z.strength||0) / (z.age + 1));
    }

    res.zones = merged;
    res.summary = {rawImpulses: res.impulses.length, zones: res.zones.length, revisits: res.revisits.length};
    return res;
  }

  function detectConfirmation(candles){
    const vols = candles.map(c=>c.v||0);
    const avgV = sma(vols, Math.min(20,candles.length))||1;
    const last = candles[candles.length-1];
    const volSpike = last.v > avgV * 1.8;
    const closes = candles.map(c=>c.c);
    const sma5 = sma(closes, Math.min(5,closes.length));
    const momentum = last.c - sma5;
    const momentumShift = Math.abs(momentum) > (sma(closes.map((v,i,arr)=>i?arr[i]-arr[i-1]:0),5)||0.5);
    const body = Math.abs(last.c - last.o);
    const upperWick = last.h - Math.max(last.c,last.o);
    const lowerWick = Math.min(last.c,last.o) - last.l;
    const rejection = (upperWick > body*1.8 && last.c<last.o) || (lowerWick > body*1.8 && last.c>last.o);
    return {volSpike,momentumShift,rejection,last,avgV};
  }

  function analyzeCandleBehavior(candles){
    const empty = {strengthScore:0,rejectionScore:0,breakoutQuality:'none',direction:'neutral',reasons:[]};
    if(!candles || !candles.length) return empty;
    const last = candles[candles.length-1];
    const prev = candles[candles.length-2] || last;
    const next = candles[candles.length] || null;
    const range = candleRange(last);
    if(range === 0) return empty;

    const bodies = candles.map(candleBody);
    const avgBody = sma(bodies, Math.min(20, bodies.length)) || candleBody(last) || 1;
    const body = candleBody(last);
    const prevBody = candleBody(prev) || body || 1;
    const closePos = (last.c - last.l) / range;
    const atr = calculateAtr(candles, 14) || range;
    const direction = last.c > last.o ? 'bullish' : last.c < last.o ? 'bearish' : 'neutral';
    const volume = Number(last.v || 0);
    const estimatedBuyVolume = volume * clamp(closePos, 0, 1);
    const estimatedSellVolume = Math.max(0, volume - estimatedBuyVolume);
    const delta = estimatedBuyVolume - estimatedSellVolume;
    const deltas = candles.slice(-20).map(c => {
      const r = candleRange(c) || 1;
      const pos = clamp((c.c - c.l) / r, 0, 1);
      const v = Number(c.v || 0);
      return v * pos - (v * (1 - pos));
    });
    const avgAbsDelta = sma(deltas.map(v => Math.abs(v)), deltas.length) || Math.abs(delta) || 1;
    const bullishTrap = direction === 'bullish' && delta < 0;
    const bearishTrap = direction === 'bearish' && delta > 0;

    let strength = 0;
    strength += clamp((body / avgBody) * 25, 0, 35);
    strength += clamp((range / atr) * 20, 0, 25);
    if(direction === 'bullish') strength += closePos > 0.7 ? 25 : closePos > 0.55 ? 12 : 0;
    if(direction === 'bearish') strength += closePos < 0.3 ? 25 : closePos < 0.45 ? 12 : 0;
    if(body / range > 0.55) strength += 15;
    if(direction === 'bullish' && delta > avgAbsDelta * 1.3) strength += 20;
    if(direction === 'bearish' && Math.abs(delta) > avgAbsDelta * 1.3 && delta < 0) strength += 20;
    if(bullishTrap || bearishTrap) strength -= 18;

    const upperWick = last.h - Math.max(last.c,last.o);
    const lowerWick = Math.min(last.c,last.o) - last.l;
    const safeBody = body || range * 0.05 || 1;
    const upperWickRatio = upperWick / safeBody;
    const lowerWickRatio = lowerWick / safeBody;
    let rejection = 0;
    if(upperWick > body * 1.4 && closePos < 0.55) rejection += 45;
    if(lowerWick > body * 1.4 && closePos > 0.45) rejection += 45;
    rejection += clamp((Math.max(upperWick, lowerWick) / range) * 45, 0, 45);
    let wickRatioScore = 0;
    if(lowerWickRatio > 2) wickRatioScore += 25;
    else if(lowerWickRatio > 1) wickRatioScore += 12;
    else if(lowerWickRatio < 0.5 && direction === 'bullish') wickRatioScore -= 10;
    if(upperWickRatio > 2) wickRatioScore += 25;
    else if(upperWickRatio > 1) wickRatioScore += 12;
    else if(upperWickRatio < 0.5 && direction === 'bearish') wickRatioScore -= 10;
    rejection += wickRatioScore;

    const bodyLow = Math.min(last.o, last.c);
    const bodyHigh = Math.max(last.o, last.c);
    const prevBodyLow = Math.min(prev.o, prev.c);
    const prevBodyHigh = Math.max(prev.o, prev.c);
    const bodyCoversPrev = bodyLow <= prevBodyLow && bodyHigh >= prevBodyHigh;
    const bullEngulfBase = direction === 'bullish' && last.c > prev.o && last.o < prev.c && body > prevBody * 1.2;
    const bearEngulfBase = direction === 'bearish' && last.c < prev.o && last.o > prev.c && body > prevBody * 1.2;
    const engulfingConfirmed = !!(next && ((bullEngulfBase && next.c > next.o) || (bearEngulfBase && next.c < next.o)));
    const engulfingScore = engulfingConfirmed ? 30 : (bullEngulfBase || bearEngulfBase) ? 10 : bodyCoversPrev ? -15 : 0;
    strength += Math.max(0, engulfingScore);

    let momentumRun = 1;
    for(let i = candles.length - 2; i >= 0; i--){
      const d = candles[i].c > candles[i].o ? 'bullish' : candles[i].c < candles[i].o ? 'bearish' : 'neutral';
      if(d !== direction || d === 'neutral') break;
      momentumRun++;
    }
    const singleCandleSpike = range > atr * 1.8 && momentumRun === 1;
    const momentumScore = momentumRun >= 3 ? 20 : singleCandleSpike ? -15 : 0;
    strength += momentumScore;
    const exhaustionRisk = momentumRun >= 4 ? 'HIGH' : momentumRun >= 3 ? 'MEDIUM' : 'LOW';

    const reasons = [];
    if(body > avgBody * 1.5) reasons.push('large_body');
    if(direction === 'bullish' && closePos > 0.7) reasons.push('close_near_high');
    if(direction === 'bearish' && closePos < 0.3) reasons.push('close_near_low');
    if(rejection > 60) reasons.push('clear_rejection_wick');
    if(bullishTrap) reasons.push('bullish_delta_trap');
    if(bearishTrap) reasons.push('bearish_delta_trap');
    if(engulfingScore > 0) reasons.push(engulfingConfirmed ? 'confirmed_engulfing' : 'engulfing_needs_followthrough');
    if(momentumRun >= 3) reasons.push(`${momentumRun}_candle_momentum_run`);
    if(singleCandleSpike) reasons.push('single_candle_bos_spike_risk');

    return {
      strengthScore: Math.round(clamp(strength, 0, 100)),
      rejectionScore: Math.round(clamp(rejection, 0, 100)),
      breakoutQuality: strength > 70 ? 'strong' : strength > 45 ? 'medium' : 'weak',
      direction,
      delta:round(delta, 2),
      avgAbsDelta:round(avgAbsDelta, 2),
      bullishTrap,
      bearishTrap,
      wickRatios:{upper:round(upperWickRatio, 2), lower:round(lowerWickRatio, 2), score:wickRatioScore},
      engulfing:{bullish:bullEngulfBase, bearish:bearEngulfBase, confirmed:engulfingConfirmed, score:engulfingScore},
      momentum:{run:momentumRun, score:momentumScore, exhaustionRisk},
      reasons
    };
  }

  function generateSignal(engines){
    const ms = engines.market; const liq = engines.liquidity; const zones = engines.zones; const conf = engines.confirmation;
    let score = 0; const reasons = [];
    let side = null;
    if(ms.trend==='up'){ score+=1; reasons.push('structure_up'); }
    if(ms.trend==='down'){ score-=1; reasons.push('structure_down'); }
    if(ms.bos){ if(ms.bos.direction==='bullish'){ score+=2; reasons.push('bos_bull'); side='LONG'; } else { score-=2; reasons.push('bos_bear'); side='SHORT'; }}
    if(liq.stopHunts && liq.stopHunts.length){ reasons.push('liquidity_sweep'); score+= (side==='LONG'?1: -1); }
    if(conf.volSpike){ score += 1; reasons.push('vol_spike'); }
    if(conf.rejection){ score += (side==='LONG'?1:-1); reasons.push('rejection'); }

    let decision = {side:'NONE',entry:null,stop:null,tp:null,confidence:0,reason:reasons};
    const last = engines.candles[engines.candles.length-1];
    if(score>1 || (side==='LONG' && score>0)){
      decision.side='LONG'; decision.entry=last.c; const recentLow = findRecentLow(engines.candles); decision.stop = recentLow*0.995; decision.tp = decision.entry + (decision.entry - decision.stop)*2; decision.confidence = Math.min(95, 40 + score*15);
    } else if(score < -1 || (side==='SHORT' && score<0)){
      decision.side='SHORT'; decision.entry=last.c; const recentHigh = findRecentHigh(engines.candles); decision.stop = recentHigh*1.005; decision.tp = decision.entry - (decision.stop - decision.entry)*2; decision.confidence = Math.min(95, 40 + (-score)*15);
    }
    decision.reason = reasons.join(', ');
    return decision;
  }

  function confirmedCandles(candles){
    return (candles || []).filter(c => c && c.isClosed !== false);
  }

  function confirmedTimeframes(timeframes){
    const out = {};
    for(const key of Object.keys(timeframes || {})){
      out[key] = confirmedCandles(timeframes[key]);
    }
    return out;
  }

  function normalizeDecisionInput(input){
    if(Array.isArray(input)){
      const candles = confirmedCandles(input);
      return {
        timeframes:{execution:candles},
        primaryCandles:candles,
        account:{},
        market:{}
      };
    }
    const timeframes = confirmedTimeframes(input.timeframes || input.candlesByTimeframe || {});
    const rawPrimary = input.candles || timeframes['15M'] || timeframes['15m'] || timeframes.execution || timeframes['5M'] || timeframes['5m'] || [];
    const primaryCandles = confirmedCandles(rawPrimary);
    return {
      timeframes:Object.keys(timeframes).length ? timeframes : {execution:primaryCandles},
      primaryCandles,
      account:input.account || {},
      market:input.market || {},
      symbol:input.symbol || (input.account && input.account.symbol) || '',
      newsEvents:input.newsEvents || [],
      openTrade:input.openTrade || null,
      now:input.now ? new Date(input.now) : new Date()
    };
  }

  function detectSession(now){
    const h = now.getUTCHours();
    if(h >= 0 && h < 7) return 'Asia';
    if(h >= 7 && h < 12) return 'London';
    if(h >= 12 && h < 21) return 'New York';
    return 'Rollover';
  }

  function minutesUntilNews(events, now){
    if(!events || !events.length) return null;
    let best = null;
    for(const ev of events){
      if((ev.impact || '').toLowerCase() !== 'high') continue;
      if(ev.currency && !['USD','US'].includes(String(ev.currency).toUpperCase())) continue;
      const t = new Date(ev.time || ev.timestamp || ev.date);
      if(isNaN(t.getTime())) continue;
      const mins = Math.round((t.getTime() - now.getTime()) / 60000);
      if(mins >= -15 && mins <= 60 && (best === null || Math.abs(mins) < Math.abs(best.minutes))){
        best = {event:ev, minutes:mins};
      }
    }
    return best;
  }

  function evaluateTradability(candles, context){
    const reasons = [];
    const now = context.now || new Date();
    const session = detectSession(now);
    const last = candles[candles.length-1];
    const atr = calculateAtr(candles, 14);
    const atrPct = last && last.c ? atr / last.c : 0;
    const spread = Number(context.market.spread || 0);
    const news = minutesUntilNews(context.newsEvents, now);
    let status = 'ALLOWED';

    if(news && news.minutes >= 0 && news.minutes <= 30){
      status = 'BLOCKED';
      reasons.push(`High-impact USD news in ${news.minutes} minutes`);
    } else if(news && news.minutes < 0){
      status = 'BLOCKED';
      reasons.push('Post-news reset window is active');
    }

    if(spread && last && spread / last.c > 0.00035){
      status = 'BLOCKED';
      reasons.push('Spread is elevated for XAUUSD risk control');
    }
    if(session === 'Rollover'){
      status = status === 'BLOCKED' ? status : 'WAIT';
      reasons.push('Rollover liquidity is thin');
    }
    if(atrPct > 0.012){
      status = status === 'BLOCKED' ? status : 'WAIT';
      reasons.push('Abnormal candle volatility; wait for structure to reform');
    }

    return {
      status,
      session,
      spread,
      atr:round(atr, 3),
      reasons:reasons.length ? reasons : ['Market conditions are tradable']
    };
  }

  function classifyRegime(analysis, candles, tradability){
    const atr = calculateAtr(candles, 14);
    const last = candles[candles.length-1];
    const atrPct = last && last.c ? atr / last.c : 0;
    const swings = analysis.market.swings || [];
    const recentRange = candles.slice(-30).reduce((m,c)=>({h:Math.max(m.h,c.h),l:Math.min(m.l,c.l)}), {h:-Infinity,l:Infinity});
    const rangePct = last && last.c ? (recentRange.h - recentRange.l) / last.c : 0;
    let regime = 'Choppy/indecisive';
    let allowedStrategies = ['Wait for cleaner structure'];

    if(tradability.status === 'BLOCKED'){
      regime = 'High-volatility news mode';
      allowedStrategies = ['News avoidance / post-news reset'];
    } else if(analysis.liquidity.stopHunts.length){
      regime = 'Liquidity sweep/reversal mode';
      allowedStrategies = ['Liquidity sweep reversal', 'Range reversal'];
    } else if(analysis.market.bos && analysis.confirmation.momentumShift){
      regime = 'Breakout continuation mode';
      allowedStrategies = ['BOS retest continuation'];
    } else if(analysis.market.trend === 'up'){
      regime = 'Bullish trend';
      allowedStrategies = ['BOS retest continuation', 'Demand pullback'];
    } else if(analysis.market.trend === 'down'){
      regime = 'Bearish trend';
      allowedStrategies = ['BOS retest continuation', 'Supply pullback'];
    } else if(rangePct < 0.008 || swings.length >= 4){
      regime = 'Range-bound';
      allowedStrategies = ['Liquidity sweep reversal', 'Range reversal'];
    }

    if(atrPct < 0.0015 && tradability.session === 'Asia'){
      regime = 'Low-liquidity Asian session';
      allowedStrategies = ['Range reversal only'];
    }

    return {regime, allowedStrategies, atrPct:round(atrPct * 100, 3), recentRangePct:round(rangePct * 100, 3)};
  }

  function buildMultiTimeframeBias(timeframes){
    const weights = {'1D':4,'Daily':4,'D':4,'4H':3,'4h':3,'1H':2,'1h':2,'15M':1,'15m':1,'5M':0.5,'5m':0.5,execution:1};
    const details = [];
    let score = 0, total = 0;
    for(const key of Object.keys(timeframes)){
      const candles = timeframes[key];
      if(!candles || candles.length < 5) continue;
      const analysis = analyzeMarket(candles);
      const w = weights[key] || 1;
      const dirScore = analysis.market.trend === 'up' ? 1 : analysis.market.trend === 'down' ? -1 : 0;
      score += dirScore * w;
      total += w;
      details.push({timeframe:key, trend:analysis.market.trend, bos:analysis.market.bos, weight:w});
    }
    const norm = total ? score / total : 0;
    const bias = norm > 0.25 ? 'Bullish' : norm < -0.25 ? 'Bearish' : 'Neutral';
    return {
      bias,
      confidence:Math.round(clamp(Math.abs(norm) * 100, 25, 90)),
      allowedDirection:bias === 'Bullish' ? 'Long only' : bias === 'Bearish' ? 'Short only' : 'Both with sweep confirmation',
      details
    };
  }

  function buildLiquidityMap(candles, analysis){
    const levels = [];
    const last = candles[candles.length-1];
    const prev = candles[candles.length-2];
    if(prev){
      levels.push({name:'Previous candle high', type:'buy-side', price:prev.h, minor:true, actionable:false});
      levels.push({name:'Previous candle low', type:'sell-side', price:prev.l, minor:true, actionable:false});
    }
    for(const l of analysis.liquidity.notableLevels || []){
      levels.push({name:l.role || l.type, type:l.type === 'high' ? 'buy-side' : 'sell-side', price:l.price, touches:l.count, actionable:true});
    }
    if(last && last.c){
      const step = roundNumberStep(last.c);
      const lower = Math.floor(last.c / step) * step;
      levels.push({name:'Round number below', type:'sell-side', price:lower, actionable:true});
      levels.push({name:'Round number above', type:'buy-side', price:lower + step, actionable:true});
    }
    const digits = priceDigits(last && last.c);
    levels.sort((a,b)=>Math.abs(a.price - last.c) - Math.abs(b.price - last.c));
    const mapped = levels.slice(0,8).map(l=>Object.assign({}, l, {
      price:round(l.price, digits),
      distance:round(Math.abs(l.price - last.c), digits),
      distancePct:last && last.c ? round(Math.abs(l.price - last.c) / last.c * 100, 3) : null
    }));
    const actionableNearest = mapped.filter(l => l.actionable !== false && !l.minor);
    const warningLevel = actionableNearest[0];
    return {
      nearest:mapped.slice(0,5),
      actionableNearest:actionableNearest.slice(0,5),
      sweeps:analysis.liquidity.stopHunts.slice(-5),
      warning:warningLevel && Math.abs(warningLevel.price - last.c) / last.c < 0.0015
        ? `Price is close to ${warningLevel.type} liquidity near ${round(warningLevel.price,digits)}`
        : null
    };
  }

  function analyzeVolumeContext(candles){
    const last = candles[candles.length-1];
    const vols = candles.map(c=>Number(c.v || 0));
    const avg20 = sma(vols, Math.min(20, vols.length)) || 0;
    const avg50 = sma(vols, Math.min(50, vols.length)) || avg20 || 1;
    const ratio = avg20 ? Number(last.v || 0) / avg20 : 1;
    const recentVol = sma(vols.slice(-5), Math.min(5, vols.length)) || 0;
    let state = 'Normal';
    let score = 50;
    const reasons = [];
    if(ratio >= 1.8){ state = 'Expansion'; score = 82; reasons.push('Volume expansion supports displacement/BOS'); }
    else if(ratio >= 1.25){ state = 'Healthy'; score = 66; reasons.push('Volume is above average'); }
    else if(ratio <= 0.65){ state = 'Thin'; score = 28; reasons.push('Volume is thin; breakout follow-through is unreliable'); }
    else reasons.push('Volume is near average');
    if(recentVol < avg50 * 0.75){
      score -= 10;
      reasons.push('Recent participation is fading');
    }
    return {
      state,
      score:Math.round(clamp(score, 0, 100)),
      ratio:round(ratio, 2),
      lastVolume:round(last.v || 0, 2),
      avgVolume:round(avg20, 2),
      confirmsBreakout:ratio >= 1.25,
      reasons:[...new Set(reasons)]
    };
  }

  function buildTrendQuality(candles, analysis){
    const swings = (analysis.market.swings || []).slice(-10);
    const atr = calculateAtr(candles, 14) || 0;
    const last = candles[candles.length-1];
    const closes = candles.map(c=>c.c);
    const fast = sma(closes, Math.min(9, closes.length));
    const slow = sma(closes, Math.min(21, closes.length));
    let score = 35;
    const reasons = [];
    if(analysis.market.trend === 'up' || analysis.market.trend === 'down'){
      score += 20;
      reasons.push(`Structure trend is ${analysis.market.trend}`);
    } else {
      reasons.push('Structure is not trending cleanly');
    }
    if(analysis.market.bos){
      score += 15;
      reasons.push('Recent BOS adds trend quality');
    }
    if(atr && last && Math.abs(fast - slow) > atr * 0.25){
      score += 12;
      reasons.push('Moving-average separation supports direction');
    }
    let sameDirectionTransitions = 0;
    const highs = swings.filter(s=>s.type==='H');
    const lows = swings.filter(s=>s.type==='L');
    for(let i=1;i<highs.length;i++){
      if(analysis.market.trend === 'up' && highs[i].price > highs[i-1].price) sameDirectionTransitions++;
      if(analysis.market.trend === 'down' && highs[i].price < highs[i-1].price) sameDirectionTransitions++;
    }
    for(let i=1;i<lows.length;i++){
      if(analysis.market.trend === 'up' && lows[i].price > lows[i-1].price) sameDirectionTransitions++;
      if(analysis.market.trend === 'down' && lows[i].price < lows[i-1].price) sameDirectionTransitions++;
    }
    score += clamp(sameDirectionTransitions * 5, 0, 20);
    const recent = candles.slice(-20);
    const overlap = recent.length > 1
      ? recent.filter((c,i)=>i && c.h <= recent[i-1].h && c.l >= recent[i-1].l).length / recent.length
      : 0;
    if(overlap > 0.25){
      score -= 18;
      reasons.push('Many overlapping candles reduce trend quality');
    }
    const direction = score >= 60 ? analysis.market.trend : 'mixed';
    return {
      score:Math.round(clamp(score, 0, 100)),
      direction,
      quality:score >= 75 ? 'Clean' : score >= 55 ? 'Tradable' : score >= 40 ? 'Mixed' : 'Choppy',
      overlapPct:round(overlap * 100, 1),
      reasons:[...new Set(reasons)]
    };
  }

  function buildCryptoContext(candles, context){
    const symbol = String(context.symbol || '').toUpperCase();
    const isCrypto = /USDT|BTC|ETH|BNB|SOL|DOGE|XRP|ADA|AVAX|MATIC|DOT|LINK/.test(symbol);
    const last = candles[candles.length-1];
    const prev = candles[candles.length-2] || last;
    const atr = calculateAtr(candles, 14) || candleRange(last) || 0;
    const range = candleRange(last);
    const body = candleBody(last);
    const impulse = !!(isCrypto && atr && range > atr * 1.8 && body / (range || 1) > 0.55);
    const wickSweep = !!(isCrypto && atr && (last.h - Math.max(last.o,last.c) > atr * 0.75 || Math.min(last.o,last.c) - last.l > atr * 0.75));
    const oneCandleChase = !!(isCrypto && prev && Math.abs(last.c - prev.c) / (prev.c || 1) > 0.018);
    const warnings = [];
    if(impulse) warnings.push('Crypto impulse candle detected; wait for retest instead of chasing');
    if(wickSweep) warnings.push('Large wick suggests liquidation sweep risk');
    if(oneCandleChase) warnings.push('Large one-candle move; entry needs pullback confirmation');
    return {
      isCrypto,
      impulse,
      wickSweep,
      oneCandleChase,
      chaseRisk:impulse || oneCandleChase,
      warnings
    };
  }

  function buildRetestContext(candles, analysis, side){
    const bos = analysis.market && analysis.market.bos;
    const expected = expectedBosDirection(side);
    const last = candles[candles.length-1];
    const atr = calculateAtr(candles, 14) || candleRange(last) || last.c * 0.002;
    if(!bos || bos.direction !== expected || !bos.price){
      return {required:false, ok:true, quality:'Not required', score:50, reasons:['No matching BOS retest required yet']};
    }
    const level = bos.price;
    const recent = candles.slice(-8);
    const tolerance = atr * 0.28;
    let touched = false;
    let rejected = false;
    let depth = 0;
    if(side === 'LONG'){
      const pullbackLow = recent.reduce((m,c)=>Math.min(m,c.l), Infinity);
      touched = pullbackLow <= level + tolerance;
      rejected = touched && last.c > level && last.c >= Math.max(last.o, level);
      depth = Math.max(0, last.c - pullbackLow);
    } else {
      const pullbackHigh = recent.reduce((m,c)=>Math.max(m,c.h), -Infinity);
      touched = pullbackHigh >= level - tolerance;
      rejected = touched && last.c < level && last.c <= Math.min(last.o, level);
      depth = Math.max(0, pullbackHigh - last.c);
    }
    const depthAtr = atr ? depth / atr : 0;
    let score = 20;
    const reasons = [];
    if(touched){ score += 35; reasons.push('Price retested the broken BOS level'); }
    else reasons.push('BOS level has not been retested deeply enough');
    if(rejected){ score += 30; reasons.push('Retest rejected in setup direction'); }
    else reasons.push('No clean rejection from retest yet');
    if(depthAtr >= 0.35){ score += 15; reasons.push('Retest depth is meaningful versus ATR'); }
    else reasons.push('Retest depth is shallow');
    return {
      required:true,
      ok:touched && rejected && depthAtr >= 0.25,
      quality:score >= 80 ? 'Clean retest' : score >= 55 ? 'Partial retest' : 'Shallow/no retest',
      score:Math.round(clamp(score, 0, 100)),
      level:round(level, priceDigits(level)),
      depthAtr:round(depthAtr, 2),
      reasons:[...new Set(reasons)]
    };
  }

  function buildHtfZoneAlignment(context, primaryCandles){
    const price = primaryCandles[primaryCandles.length-1].c;
    const htfKeys = ['4H','4h','1H','1h','D','1D','Daily'];
    const hits = [];
    const warnings = [];
    let longOk = true;
    let shortOk = true;
    for(const key of htfKeys){
      const candles = context.timeframes && context.timeframes[key];
      if(!candles || candles.length < 20) continue;
      const analysis = analyzeMarket(candles);
      const atr = calculateAtr(candles, 14) || price * 0.002;
      const zonePad = atr * 0.18;
      const zones = (analysis.zones && analysis.zones.zones || []).slice(-8);
      for(const z of zones){
        const inside = price >= z.low - zonePad && price <= z.high + zonePad;
        if(!inside) continue;
        hits.push({timeframe:key, type:z.dir, low:round(z.low, priceDigits(z.low)), high:round(z.high, priceDigits(z.high)), score:z.score || 0});
        if(z.dir === 'supply') longOk = false;
        if(z.dir === 'demand') shortOk = false;
      }
      const fvg = detectFvgZones(candles);
      for(const z of fvg.bullish){
        if(priceInsideZone(price, z)){ hits.push({timeframe:key, type:'bullish FVG', low:round(z.low, priceDigits(z.low)), high:round(z.high, priceDigits(z.high)), score:50}); shortOk = false; }
      }
      for(const z of fvg.bearish){
        if(priceInsideZone(price, z)){ hits.push({timeframe:key, type:'bearish FVG', low:round(z.low, priceDigits(z.low)), high:round(z.high, priceDigits(z.high)), score:50}); longOk = false; }
      }
    }
    if(!longOk) warnings.push('Long is pressing into HTF supply/bearish imbalance');
    if(!shortOk) warnings.push('Short is pressing into HTF demand/bullish imbalance');
    return {
      longOk,
      shortOk,
      hits:hits.slice(-6),
      summary:hits.length ? hits.map(h=>`${h.timeframe} ${h.type}`).join(', ') : 'No active HTF zone conflict',
      warnings
    };
  }

  function buildSessionRules(tradability, regime, volumeContext, candleBehavior){
    const session = tradability.session;
    const rules = {session, longOk:true, shortOk:true, continuationOk:true, sweepOk:true, reasons:[]};
    if(session === 'Asia'){
      rules.continuationOk = false;
      rules.reasons.push('Asia session: prefer range/sweep setups; block breakout chase');
    }
    if(session === 'London'){
      rules.reasons.push('London session: require sweep/displacement or strong volume for continuation');
      if(volumeContext && !volumeContext.confirmsBreakout && regime.regime === 'Breakout continuation mode'){
        rules.continuationOk = false;
        rules.reasons.push('London breakout lacks volume expansion');
      }
    }
    if(session === 'New York'){
      rules.reasons.push('New York session: continuation allowed only after structure stays clean');
      if(candleBehavior && candleBehavior.breakoutQuality === 'weak'){
        rules.continuationOk = false;
        rules.reasons.push('NY continuation needs stronger candle quality');
      }
    }
    if(session === 'Rollover'){
      rules.longOk = false;
      rules.shortOk = false;
      rules.continuationOk = false;
      rules.sweepOk = false;
      rules.reasons.push('Rollover session blocks new setups');
    }
    return rules;
  }

  function detectFvgZones(candles){
    const bullish = [];
    const bearish = [];
    const start = Math.max(2, candles.length - 60);
    for(let i=start;i<candles.length;i++){
      const left = candles[i-2];
      const mid = candles[i-1];
      const cur = candles[i];
      const midRange = candleRange(mid) || 0;
      const midBody = candleBody(mid) || 0;
      const displacement = midRange ? midBody / midRange >= 0.55 : false;
      if(left.h < cur.l && displacement){
        bullish.push({type:'bullish FVG', low:left.h, high:cur.l, createdAt:i, source:'Fair Value Gap after bullish displacement'});
      }
      if(left.l > cur.h && displacement){
        bearish.push({type:'bearish FVG', low:cur.h, high:left.l, createdAt:i, source:'Fair Value Gap after bearish displacement'});
      }
    }
    return {bullish:bullish.slice(-5), bearish:bearish.slice(-5)};
  }

  function detectOrderBlocks(candles){
    const bullish = [];
    const bearish = [];
    const atr = calculateAtr(candles, 14) || 0;
    const start = Math.max(1, candles.length - 60);
    for(let i=start;i<candles.length;i++){
      const prev = candles[i-1];
      const cur = candles[i];
      const curRange = candleRange(cur) || 0;
      const curBody = candleBody(cur) || 0;
      const displacement = atr ? curRange > atr * 1.15 && curBody / curRange >= 0.55 : curBody > 0;
      if(!displacement) continue;
      if(prev.c < prev.o && cur.c > cur.o){
        bullish.push({type:'bullish order block', low:prev.l, high:Math.max(prev.o, prev.c), createdAt:i-1, source:'Last bearish candle before bullish displacement'});
      }
      if(prev.c > prev.o && cur.c < cur.o){
        bearish.push({type:'bearish order block', low:Math.min(prev.o, prev.c), high:prev.h, createdAt:i-1, source:'Last bullish candle before bearish displacement'});
      }
    }
    return {bullish:bullish.slice(-5), bearish:bearish.slice(-5)};
  }

  function priceInsideZone(price, zone){
    return !!(zone && price >= zone.low && price <= zone.high);
  }

  function nearestZone(price, zones){
    if(!zones || !zones.length) return null;
    return zones
      .map(z => Object.assign({}, z, {distance:priceInsideZone(price, z) ? 0 : Math.min(Math.abs(price - z.low), Math.abs(price - z.high))}))
      .sort((a,b)=>a.distance-b.distance)[0] || null;
  }

  function buildLocationContext(candles, analysis){
    const last = candles[candles.length-1];
    const lookback = candles.slice(Math.max(0, candles.length - 80));
    const high = lookback.reduce((m,c)=>Math.max(m,c.h), -Infinity);
    const low = lookback.reduce((m,c)=>Math.min(m,c.l), Infinity);
    const range = Math.max(high - low, 0);
    const mid = low + range / 2;
    const positionPct = range ? (last.c - low) / range : 0.5;
    const zone = positionPct <= 0.45 ? 'Discount' : positionPct >= 0.55 ? 'Premium' : 'Equilibrium';
    const fvg = detectFvgZones(candles);
    const orderBlocks = detectOrderBlocks(candles);
    const lastSweep = (analysis.liquidity.stopHunts || []).slice(-1)[0];
    const longFvg = nearestZone(last.c, fvg.bullish);
    const shortFvg = nearestZone(last.c, fvg.bearish);
    const longOb = nearestZone(last.c, orderBlocks.bullish);
    const shortOb = nearestZone(last.c, orderBlocks.bearish);
    const longInValue = zone === 'Discount' || priceInsideZone(last.c, longFvg) || priceInsideZone(last.c, longOb);
    const shortInValue = zone === 'Premium' || priceInsideZone(last.c, shortFvg) || priceInsideZone(last.c, shortOb);
    const longSweepException = !!(lastSweep && lastSweep.direction === 'short-sweep');
    const shortSweepException = !!(lastSweep && lastSweep.direction === 'long-sweep');
    const warnings = [];
    const reasons = [];
    if(zone === 'Premium') warnings.push('Longs are lower quality in premium unless sell-side liquidity was swept first');
    if(zone === 'Discount') warnings.push('Shorts are lower quality in discount unless buy-side liquidity was swept first');
    if(longInValue) reasons.push('Long location has discount/FVG/order-block support');
    if(shortInValue) reasons.push('Short location has premium/FVG/order-block support');
    return {
      range:{
        high:round(high, priceDigits(high)),
        low:round(low, priceDigits(low)),
        mid:round(mid, priceDigits(mid)),
        positionPct:round(positionPct * 100, 1),
        zone
      },
      fvg,
      orderBlocks,
      nearest:{
        longFvg,
        shortFvg,
        longOrderBlock:longOb,
        shortOrderBlock:shortOb
      },
      longAllowedLocation:longInValue || longSweepException || zone === 'Equilibrium',
      shortAllowedLocation:shortInValue || shortSweepException || zone === 'Equilibrium',
      warnings,
      reasons
    };
  }

  function detectSetupFormation(analysis, candleBehavior, bias, regime){
    const reasons = [];
    let setup = null, direction = null, quality = 'Low', needs = [];
    const lastSweep = (analysis.liquidity.stopHunts || []).slice(-1)[0];

    if(lastSweep){
      if(lastSweep.direction === 'short-sweep' && bias.bias !== 'Bearish'){
        setup = 'Bullish liquidity sweep';
        direction = 'LONG';
        reasons.push('Sell-side liquidity swept and reclaimed');
        needs.push('Bullish BOS/CHOCH or clean retest');
      }
      if(lastSweep.direction === 'long-sweep' && bias.bias !== 'Bullish'){
        setup = 'Bearish liquidity sweep';
        direction = 'SHORT';
        reasons.push('Buy-side liquidity swept and rejected');
        needs.push('Bearish BOS/CHOCH or clean retest');
      }
    }

    if(!setup && analysis.market.bos){
      if(analysis.market.bos.direction === 'bullish' && bias.bias === 'Bullish'){
        setup = 'BOS retest continuation';
        direction = 'LONG';
        reasons.push('Bullish close beyond structural high');
        needs.push('Retest confirmation before entry');
      }
      if(analysis.market.bos.direction === 'bearish' && bias.bias === 'Bearish'){
        setup = 'BOS retest continuation';
        direction = 'SHORT';
        reasons.push('Bearish close beyond structural low');
        needs.push('Retest confirmation before entry');
      }
    }

    if(!setup && regime.regime === 'Range-bound'){
      setup = 'Range reversal watch';
      quality = 'Watch';
      needs.push('Sweep range high/low and close back inside');
    }

    if(setup && candleBehavior.strengthScore > 70) quality = 'High';
    else if(setup && (candleBehavior.strengthScore > 45 || candleBehavior.rejectionScore > 60)) quality = 'Medium';

    return {setup, direction, quality, reasons, needsConfirmation:needs};
  }

  function isCounterBias(side, bias){
    return (side === 'LONG' && bias.bias === 'Bearish') || (side === 'SHORT' && bias.bias === 'Bullish');
  }

  function buildDirectionalSetup(side, candles, analysis, candleBehavior, bias, regime, liquidityMap, locationContext, volumeContext, trendQuality, cryptoContext, htfAlignment, sessionRules){
    const reasons = [];
    const needs = [];
    let setup = null;
    let quality = 'Low';
    const last = candles[candles.length-1];
    const atr = calculateAtr(candles, 14) || candleRange(last) || last.c * 0.002;
    const lastSweep = (analysis.liquidity.stopHunts || []).slice(-1)[0];
    const counterBias = isCounterBias(side, bias);
    const directionWord = side === 'LONG' ? 'bullish' : 'bearish';
    const locationOk = side === 'LONG'
      ? !locationContext || locationContext.longAllowedLocation
      : !locationContext || locationContext.shortAllowedLocation;
    const locationZone = locationContext && locationContext.range ? locationContext.range.zone : 'Unknown';
    const trendAligned = trendQuality && trendQuality.direction !== 'mixed'
      ? ((side === 'LONG' && trendQuality.direction === 'up') || (side === 'SHORT' && trendQuality.direction === 'down'))
      : false;
    const retestContext = buildRetestContext(candles, analysis, side);
    const htfOk = side === 'LONG' ? !htfAlignment || htfAlignment.longOk : !htfAlignment || htfAlignment.shortOk;
    const pathLiquidity = (liquidityMap && liquidityMap.actionableNearest || [])[0] || null;
    const pathLiquidityDistance = pathLiquidity ? Math.abs(Number(pathLiquidity.price) - last.c) : Infinity;
    const pathLiquidityTooClose = !!(pathLiquidity && pathLiquidityDistance <= atr * 0.45);
    const liquidityPathBlocked = !!(
      pathLiquidityTooClose && (
        (side === 'SHORT' && pathLiquidity.type === 'sell-side') ||
        (side === 'LONG' && pathLiquidity.type === 'buy-side')
      )
    );
    if(side === 'LONG'){
      if(counterBias) needs.push('Counter-bias long needs stronger sweep/reclaim proof');
      if(locationContext && !locationOk) needs.push('Wait for discount/FVG/order-block retest or sell-side sweep before long');
      if(locationContext && locationOk) reasons.push(`LONG location acceptable: ${locationZone}`);
      if(lastSweep && lastSweep.direction === 'short-sweep'){
        setup = 'Bullish liquidity sweep';
        reasons.push('Sell-side liquidity swept and reclaimed');
        needs.push('Bullish BOS/CHOCH or clean retest');
      } else if(analysis.market.bos && analysis.market.bos.direction === 'bullish' && !counterBias){
        setup = 'Bullish BOS retest continuation';
        reasons.push('Bullish close beyond structural high');
        needs.push('Retest confirmation before entry');
      } else if(regime.regime === 'Range-bound'){
        setup = 'Range low reversal watch';
        reasons.push('Range conditions can support a long only after sell-side sweep');
        needs.push('Sweep range low and close back inside');
      } else if(bias.bias === 'Bullish' && locationOk && trendQuality && trendQuality.score >= 45){
        setup = 'Demand pullback watch';
        reasons.push('Bullish context supports watching for demand pullback');
        needs.push('Wait for demand/FVG reaction plus bullish BOS/CHOCH close');
      } else {
        needs.push('Wait for sell-side sweep, bullish BOS, or demand reaction');
      }
    }

    if(side === 'SHORT'){
      if(counterBias) needs.push('Counter-bias short needs stronger sweep/reclaim proof');
      if(locationContext && !locationOk) needs.push('Wait for premium/FVG/order-block retest or buy-side sweep before short');
      if(locationContext && locationOk) reasons.push(`SHORT location acceptable: ${locationZone}`);
      if(lastSweep && lastSweep.direction === 'long-sweep'){
        setup = 'Bearish liquidity sweep';
        reasons.push('Buy-side liquidity swept and rejected');
        needs.push('Bearish BOS/CHOCH or clean retest');
      } else if(analysis.market.bos && analysis.market.bos.direction === 'bearish' && !counterBias){
        setup = 'Bearish BOS retest continuation';
        reasons.push('Bearish close beyond structural low');
        needs.push('Retest confirmation before entry');
      } else if(regime.regime === 'Range-bound'){
        setup = 'Range high reversal watch';
        reasons.push('Range conditions can support a short only after buy-side sweep');
        needs.push('Sweep range high and close back inside');
      } else if(bias.bias === 'Bearish' && locationOk && trendQuality && trendQuality.score >= 45){
        setup = 'Supply pullback watch';
        reasons.push('Bearish context supports watching for supply pullback');
        needs.push('Wait for supply/FVG reaction plus bearish BOS/CHOCH close');
      } else {
        needs.push('Wait for buy-side sweep, bearish BOS, or supply reaction');
      }
    }

    if(setup && counterBias){
      reasons.push(`${side} is counter to ${bias.bias} higher-timeframe bias`);
      needs.push(`${directionWord[0].toUpperCase()}${directionWord.slice(1)} displacement candle must close before entry`);
    }
    if(setup && volumeContext && !volumeContext.confirmsBreakout && /BOS|continuation/i.test(setup)){
      needs.push('Volume expansion must confirm breakout continuation');
    }
    if(setup && trendQuality && trendQuality.score < 45 && /BOS|continuation|pullback/i.test(setup)){
      needs.push('Trend quality is weak; wait for cleaner structure');
    }
    if(setup && trendAligned){
      reasons.push(`Trend quality supports ${side}`);
    }
    if(setup && cryptoContext && cryptoContext.chaseRisk && !/sweep/i.test(setup)){
      needs.push('Crypto impulse risk: wait for retest before entry');
    }
    const continuationSetup = /BOS|continuation/i.test(setup || '');
    const sideSessionOk = side === 'LONG'
      ? !sessionRules || (sessionRules.longOk && (sessionRules.continuationOk || !continuationSetup))
      : !sessionRules || (sessionRules.shortOk && (sessionRules.continuationOk || !continuationSetup));
    if(setup && continuationSetup && retestContext.required && !retestContext.ok){
      needs.push('BOS retest depth/rejection is not confirmed');
    }
    if(setup && htfAlignment && !htfOk){
      needs.push(`${side} conflicts with higher-timeframe zone alignment`);
    }
    if(setup && sessionRules && !sideSessionOk){
      needs.push(`${sessionRules.session} session rules do not allow this setup yet`);
    }
    const deltaTrap = side === 'LONG' ? candleBehavior.bullishTrap : side === 'SHORT' ? candleBehavior.bearishTrap : false;
    const weakSweepRejection = /sweep/i.test(setup || '') && candleBehavior.wickRatios && candleBehavior.wickRatios.score < 0;
    if(setup && deltaTrap){
      needs.push(`${side} blocked by volume-delta trap candle`);
      reasons.push('Candle direction conflicts with estimated volume delta');
    }
    if(setup && weakSweepRejection){
      needs.push('Sweep entry needs stronger wick-to-body rejection');
      reasons.push('Sweep rejection wick ratio is weak');
    }
    if(setup && liquidityPathBlocked){
      needs.push(`${side} is running into nearby ${pathLiquidity.type} liquidity; wait for sweep/reaction or deeper retest`);
      reasons.push(`Nearby ${pathLiquidity.type} liquidity is too close for clean ${side} path`);
    }

    if(setup && (liquidityPathBlocked || deltaTrap || weakSweepRejection)) quality = 'Watch';
    else if(setup && candleBehavior.strengthScore > 70) quality = 'High';
    else if(setup && (candleBehavior.strengthScore > 45 || candleBehavior.rejectionScore > 60)) quality = 'Medium';
    else if(setup && /watch/i.test(setup)) quality = 'Watch';

    return {
      setup,
      direction: setup ? side : null,
      quality,
      counterBias,
      locationOk,
      locationZone,
      volumeOk:!volumeContext || volumeContext.confirmsBreakout || !/BOS|continuation/i.test(setup || ''),
      trendOk:!trendQuality || trendQuality.score >= 45 || !/BOS|continuation|pullback/i.test(setup || ''),
      cryptoOk:!cryptoContext || !cryptoContext.chaseRisk || /sweep/i.test(setup || ''),
      liquidityPathOk:!liquidityPathBlocked,
      deltaOk:!deltaTrap,
      wickRejectionOk:!weakSweepRejection,
      pathLiquidity:pathLiquidity ? {
        type:pathLiquidity.type,
        price:pathLiquidity.price,
        distance:round(pathLiquidityDistance, priceDigits(last.c))
      } : null,
      retestOk:!continuationSetup || !retestContext.required || retestContext.ok,
      retestContext,
      htfOk,
      sessionOk:sideSessionOk,
      reasons,
      needsConfirmation:[...new Set(needs)]
    };
  }

  function buildDirectionalCandidates(candles, analysis, candleBehavior, bias, regime, tradability, liquidityMap, locationContext, volumeContext, trendQuality, cryptoContext, htfAlignment, sessionRules, account){
    const sides = ['LONG','SHORT'];
    const out = {};
    for(const side of sides){
      const setup = buildDirectionalSetup(side, candles, analysis, candleBehavior, bias, regime, liquidityMap, locationContext, volumeContext, trendQuality, cryptoContext, htfAlignment, sessionRules);
      const plan = buildTradePlan(candles, analysis, setup, liquidityMap);
      const risk = calculateRiskPermission(plan, account || {});
      const state = evaluateDecisionState(analysis, setup, candleBehavior, tradability, risk, plan);
      out[side.toLowerCase()] = {
        direction:side,
        setup:setup.setup,
        quality:setup.quality,
        counterBias:setup.counterBias,
        locationOk:setup.locationOk,
        locationZone:setup.locationZone,
        volumeOk:setup.volumeOk,
        trendOk:setup.trendOk,
        cryptoOk:setup.cryptoOk,
        liquidityPathOk:setup.liquidityPathOk,
        deltaOk:setup.deltaOk,
        wickRejectionOk:setup.wickRejectionOk,
        pathLiquidity:setup.pathLiquidity,
        retestOk:setup.retestOk,
        retestContext:setup.retestContext,
        htfOk:setup.htfOk,
        sessionOk:setup.sessionOk,
        reasons:setup.reasons,
        needsConfirmation:setup.needsConfirmation,
        setupStage:state.setupStage,
        missingConditions:state.missingConditions,
        entryReadinessScore:state.entryReadinessScore,
        blockedReasons:state.blockedReasons,
        allowedActions:state.allowedActions,
        entryTriggerReady:state.setupStage === 'ENTRY_READY',
        tradePlan:plan,
        risk
      };
    }
    return out;
  }

  function choosePreferredDirection(longSetup, shortSetup){
    const candidates = [longSetup, shortSetup]
      .filter(c => c && c.setup && c.setupStage !== 'BLOCKED' && c.tradePlan && c.tradePlan.riskReward >= CONFIG.minRiskReward)
      .sort((a,b) => (b.entryReadinessScore || 0) - (a.entryReadinessScore || 0));
    if(!candidates.length) return 'NONE';
    if((candidates[0].entryReadinessScore || 0) < 25) return 'NONE';
    return candidates[0].direction;
  }

  function expectedBosDirection(side){
    return side === 'LONG' ? 'bullish' : side === 'SHORT' ? 'bearish' : null;
  }

  function hasDirectionalStructure(analysis, side){
    const expected = expectedBosDirection(side);
    return !!(expected && analysis.market && analysis.market.bos && analysis.market.bos.direction === expected);
  }

  function hasDirectionalCandle(candleBehavior, side){
    if(!side || !candleBehavior) return false;
    return side === 'LONG'
      ? candleBehavior.direction === 'bullish'
      : candleBehavior.direction === 'bearish';
  }

  function buildNextStepForecast(analysis, candleBehavior, bias, regime, liquidityMap, longSetup, shortSetup){
    const last = analysis.confirmation && analysis.confirmation.last;
    const nearest = (liquidityMap.nearest || [])[0];
    const lastSweep = (analysis.liquidity.stopHunts || []).slice(-1)[0];
    const candidates = [longSetup, shortSetup]
      .filter(c => c && c.setup)
      .sort((a,b) => (b.entryReadinessScore || 0) - (a.entryReadinessScore || 0));
    const lead = candidates[0] || null;
    const invalidationHint = lead && lead.tradePlan
      ? `${lead.direction} idea weakens if price closes through ${round(lead.tradePlan.invalidation, priceDigits(lead.tradePlan.invalidation))}`
      : 'No trade idea has a fixed invalidation yet';
    let expectation = 'Wait for cleaner market information';
    let nextCandleMust = 'Next closed candle should create sweep/reclaim, BOS/CHOCH, or clean rejection before any entry';
    let confidence = 35;
    const reasons = [];

    if(lastSweep){
      if(lastSweep.direction === 'short-sweep'){
        expectation = 'Possible bullish reversal attempt after sell-side sweep';
        nextCandleMust = 'Next candle should hold above the swept low and close bullish or break minor structure up';
        confidence = 58;
        reasons.push('sell-side liquidity was taken and reclaimed');
      }
      if(lastSweep.direction === 'long-sweep'){
        expectation = 'Possible bearish reversal attempt after buy-side sweep';
        nextCandleMust = 'Next candle should hold below the swept high and close bearish or break minor structure down';
        confidence = 58;
        reasons.push('buy-side liquidity was taken and rejected');
      }
    } else if(analysis.market.bos){
      if(analysis.market.bos.direction === 'bullish'){
        expectation = 'Bullish continuation is possible after structure break';
        nextCandleMust = 'Next candle should avoid closing back below the broken structure and preferably retest/reject upward';
        confidence = 55;
        reasons.push('bullish BOS close detected');
      } else {
        expectation = 'Bearish continuation is possible after structure break';
        nextCandleMust = 'Next candle should avoid closing back above the broken structure and preferably retest/reject downward';
        confidence = 55;
        reasons.push('bearish BOS close detected');
      }
    } else if(nearest){
      expectation = `Price may hunt nearby ${nearest.type} liquidity`;
      nextCandleMust = `Wait for reaction around ${round(nearest.price, priceDigits(nearest.price))}; do not enter until candle closes away from that level`;
      confidence = 45;
      reasons.push('nearest liquidity is close enough to influence the next move');
    }

    if(candleBehavior.direction !== 'neutral'){
      reasons.push(`last closed candle is ${candleBehavior.direction}`);
      confidence += candleBehavior.strengthScore >= 70 ? 10 : candleBehavior.strengthScore >= 45 ? 5 : 0;
    }
    if(lead && lead.counterBias){
      confidence -= 8;
      reasons.push('leading idea is counter-bias, so confirmation threshold is higher');
    }
    if(regime.regime === 'Choppy/indecisive'){
      confidence -= 10;
      reasons.push('choppy regime reduces forecast confidence');
    }

    return {
      expectation,
      nextCandleMust,
      invalidationHint,
      confidence:Math.round(clamp(confidence, 20, 80)),
      leadDirection:lead ? lead.direction : 'NONE',
      reasons:[...new Set(reasons)]
    };
  }

  function buildFormationPlan(candles, analysis, bias, liquidityMap, locationContext, htfAlignment, sessionRules){
    const last = candles[candles.length-1];
    const atr = calculateAtr(candles, 14) || candleRange(last) || last.c * 0.002;
    const nearest = (liquidityMap.actionableNearest || [])[0] || null;
    const lastSweep = (analysis.liquidity.stopHunts || []).slice(-1)[0];
    let side = null;
    let trigger = 'Wait for sweep/reclaim, BOS/CHOCH, or clean rejection before early entry';
    let context = 'No immediate trade formation';
    let watchedLevel = nearest ? nearest.price : null;
    let formationSource = 'none';

    if(lastSweep && lastSweep.direction === 'short-sweep'){
      side = 'LONG';
      watchedLevel = lastSweep.structuralLow || lastSweep.peak || watchedLevel;
      context = 'Sell-side liquidity has been swept; bullish reversal may form';
      trigger = 'Hold above swept low, print bullish rejection, then break minor structure up';
      formationSource = 'sweep';
    } else if(lastSweep && lastSweep.direction === 'long-sweep'){
      side = 'SHORT';
      watchedLevel = lastSweep.structuralHigh || lastSweep.peak || watchedLevel;
      context = 'Buy-side liquidity has been swept; bearish reversal may form';
      trigger = 'Hold below swept high, print bearish rejection, then break minor structure down';
      formationSource = 'sweep';
    } else if(nearest && nearest.type === 'buy-side'){
      side = 'SHORT';
      context = `Price is approaching buy-side liquidity near ${round(nearest.price, priceDigits(nearest.price))}`;
      trigger = 'Sweep that liquidity and close back below it, then bearish candle/CHOCH confirms';
      formationSource = 'liquidity-approach';
    } else if(nearest && nearest.type === 'sell-side'){
      side = 'LONG';
      context = `Price is approaching sell-side liquidity near ${round(nearest.price, priceDigits(nearest.price))}`;
      trigger = 'Sweep that liquidity and close back above it, then bullish candle/CHOCH confirms';
      formationSource = 'liquidity-approach';
    } else if(bias.bias === 'Bullish' && locationContext.longAllowedLocation){
      side = 'LONG';
      context = 'Bullish context supports waiting for demand/FVG reaction';
      trigger = 'Reject demand/FVG and close bullish with minor structure break';
      formationSource = 'bias-location';
    } else if(bias.bias === 'Bearish' && locationContext.shortAllowedLocation){
      side = 'SHORT';
      context = 'Bearish context supports waiting for supply/FVG reaction';
      trigger = 'Reject supply/FVG and close bearish with minor structure break';
      formationSource = 'bias-location';
    }

    if(!side){
      return {
        active:false,
        phase:'NO_FORMATION',
        side:null,
        context,
        trigger,
        reasons:['No future trade formation has enough context yet']
      };
    }

    const digits = priceDigits(last.c);
    const center = watchedLevel || last.c;
    const earlyZone = side === 'LONG'
      ? [center - atr * 0.2, center + atr * 0.15]
      : [center - atr * 0.15, center + atr * 0.2];
    const invalidation = side === 'LONG'
      ? Math.min(recentLow(candles, 12), earlyZone[0]) - atr * 0.2
      : Math.max(recentHigh(candles, 12), earlyZone[1]) + atr * 0.2;
    const chaseLevel = side === 'LONG'
      ? center + atr * 0.9
      : center - atr * 0.9;
    const htfOk = side === 'LONG' ? htfAlignment.longOk : htfAlignment.shortOk;
    const locationOk = side === 'LONG' ? locationContext.longAllowedLocation : locationContext.shortAllowedLocation;
    const sessionOk = side === 'LONG' ? sessionRules.longOk : sessionRules.shortOk;
    const active = htfOk && locationOk && sessionOk;
    const phase = active ? 'EARLY_FORMING' : 'CONTEXT_ONLY';
    const reasons = [];
    if(!htfOk) reasons.push('HTF alignment must clear before early entry');
    if(!locationOk) reasons.push('Premium/discount location is not favorable yet');
    if(!sessionOk) reasons.push('Session rules block early entry');
    if(active) reasons.push('Major context is aligned; wait for trigger candle');

    return {
      active,
      phase,
      side,
      source:formationSource,
      context,
      trigger,
      earlyEntryZone:[round(earlyZone[0], digits), round(earlyZone[1], digits)],
      invalidation:round(invalidation, digits),
      chaseLevel:round(chaseLevel, digits),
      tooLateRule:side === 'LONG'
        ? `Do not chase above ${round(chaseLevel, digits)} before confirmation`
        : `Do not chase below ${round(chaseLevel, digits)} before confirmation`,
      watchedLevel:round(center, digits),
      reasons:[...new Set(reasons)]
    };
  }

  function evaluateDecisionState(analysis, setup, candleBehavior, tradability, risk, plan){
    const missing = [];
    const blockedReasons = [];
    const allowedActions = [];
    let score = 0;
    let setupStage = 'NO_SETUP';
    const directionalStructure = hasDirectionalStructure(analysis, setup.direction);
    const directionalCandle = hasDirectionalCandle(candleBehavior, setup.direction);

    if(tradability.status === 'BLOCKED'){
      blockedReasons.push(...tradability.reasons);
      return {
        setupStage:'BLOCKED',
        missingConditions:['Wait for tradability filters to clear'],
        entryReadinessScore:0,
        blockedReasons,
        allowedActions:['No new trade']
      };
    }

    if(setup.setup){
      setupStage = setup.direction ? 'SETUP_FORMING' : 'WATCHING';
      score += 25;
      allowedActions.push('Monitor setup conditions');
      if(setup.counterBias){
        score -= 10;
        missing.push('Counter-bias setup: require stronger displacement and reclaim');
      }
      if(setup.locationOk === false){
        score -= 15;
        missing.push(`${setup.direction} location is poor from premium/discount/FVG context`);
      } else if(setup.locationOk === true){
        score += 10;
      }
      if(setup.volumeOk === false){
        score -= 12;
        missing.push('Volume confirmation is not strong enough for this setup');
      } else if(setup.volumeOk === true){
        score += 5;
      }
      if(setup.trendOk === false){
        score -= 12;
        missing.push('Trend quality is too weak for continuation entry');
      } else if(setup.trendOk === true){
        score += 5;
      }
      if(setup.cryptoOk === false){
        score -= 15;
        missing.push('Crypto impulse/chase risk: wait for retest confirmation');
      }
      if(setup.liquidityPathOk === false){
        score -= 20;
        missing.push('Nearby liquidity is in the trade path; wait for sweep/reaction or a deeper retest');
      }
      if(setup.deltaOk === false){
        score -= 22;
        missing.push('Volume-delta trap: candle direction conflicts with estimated buying/selling pressure');
      }
      if(setup.wickRejectionOk === false){
        score -= 18;
        missing.push('Sweep rejection wick-to-body ratio is too weak');
      }
      if(setup.retestOk === false){
        score -= 18;
        missing.push('Retest depth/rejection is not confirmed');
      } else if(setup.retestOk === true && setup.retestContext && setup.retestContext.required){
        score += 8;
      }
      if(setup.htfOk === false){
        score -= 18;
        missing.push('Higher-timeframe zone alignment conflicts with this direction');
      } else if(setup.htfOk === true){
        score += 4;
      }
      if(setup.sessionOk === false){
        score -= 18;
        missing.push('Session rules block this setup type for now');
      }
    } else {
      missing.push('No strategy setup detected');
      allowedActions.push('Wait');
    }

    if((analysis.liquidity.stopHunts || []).length){
      score += 15;
    } else if(setup.setup && /sweep/i.test(setup.setup)){
      missing.push('Liquidity sweep not confirmed');
    }

    if(directionalStructure){
      setupStage = setup.direction ? 'STRUCTURE_CONFIRMED' : setupStage;
      score += 20;
    } else if(setup.direction){
      missing.push(`${setup.direction} BOS/CHOCH close confirmation`);
    }

    if(directionalCandle && (candleBehavior.strengthScore >= 55 || candleBehavior.rejectionScore >= 55)){
      score += 15;
    } else if(setup.direction){
      missing.push(directionalCandle ? 'Candle confirmation is weak' : 'Wait for a confirming candle close in setup direction');
    }

    if(plan && plan.riskReward >= CONFIG.minRiskReward){
      score += 15;
    } else if(plan){
      score -= 20;
      missing.push(`R:R below ${CONFIG.minRiskReward}`);
    }

    if(risk && risk.allowed && plan){
      score += 10;
    } else if(plan && risk && risk.reasons){
      blockedReasons.push(...risk.reasons);
    }

    const entryThreshold = setup.counterBias ? 85 : 75;
    const engineGatesOk = setup.locationOk !== false
      && setup.volumeOk !== false
      && setup.trendOk !== false
      && setup.cryptoOk !== false
      && setup.liquidityPathOk !== false
      && setup.deltaOk !== false
      && setup.wickRejectionOk !== false
      && setup.retestOk !== false
      && setup.htfOk !== false
      && setup.sessionOk !== false;
    if(plan && setup.direction && engineGatesOk && directionalStructure && directionalCandle && score >= entryThreshold && risk.allowed){
      setupStage = 'ENTRY_READY';
      allowedActions.push('Trade can be considered after manual confirmation');
    } else if(plan && setup.direction && score >= 55 && plan.riskReward >= CONFIG.minRiskReward){
      setupStage = 'RETEST_NEEDED';
      allowedActions.push('Wait for retest or cleaner trigger');
    } else if(plan && setup.direction && plan.riskReward < CONFIG.minRiskReward){
      setupStage = 'WATCH_ONLY';
      allowedActions.push('Watch only: reward is too small for live/demo entry');
    }

    if(!missing.length && setup.needsConfirmation && setup.needsConfirmation.length && setupStage !== 'ENTRY_READY'){
      missing.push(...setup.needsConfirmation);
    }

    return {
      setupStage,
      missingConditions:[...new Set(missing)],
      entryReadinessScore:Math.round(clamp(score, 0, 100)),
      directionalStructure,
      directionalCandle,
      blockedReasons:[...new Set(blockedReasons)],
      allowedActions:[...new Set(allowedActions.length ? allowedActions : ['Wait'])]
    };
  }

  function buildSignalGrade(setup, plan, risk, decisionState, masterScore){
    const hardReasons = [];
    const softReasons = [];
    if(!setup || !setup.direction) hardReasons.push('No directional setup');
    if(!plan) hardReasons.push('No trade plan');
    if(plan && plan.riskReward < CONFIG.minRiskReward) hardReasons.push('R:R below minimum');
    if(risk && !risk.allowed) hardReasons.push('Risk engine blocked');
    if(setup && setup.locationOk === false) hardReasons.push('Bad premium/discount location');
    if(setup && setup.htfOk === false) hardReasons.push('HTF zone conflict');
    if(setup && setup.cryptoOk === false) hardReasons.push('Crypto chase risk');
    if(setup && setup.liquidityPathOk === false) hardReasons.push('Nearby liquidity blocks trade path');
    if(setup && setup.deltaOk === false) hardReasons.push('Volume-delta trap candle');
    if(setup && setup.wickRejectionOk === false) hardReasons.push('Weak sweep rejection wick ratio');
    if(setup && setup.sessionOk === false) hardReasons.push('Session rule block');
    if(decisionState && !decisionState.directionalStructure) hardReasons.push('Missing BOS/CHOCH');
    if(decisionState && !decisionState.directionalCandle) hardReasons.push('Missing confirming candle');
    if(masterScore && masterScore.score < 75) hardReasons.push('Master score below entry threshold');
    if(setup && setup.volumeOk === false) softReasons.push('Volume confirmation weak');
    if(setup && setup.trendOk === false) softReasons.push('Trend quality weak');
    if(setup && setup.retestOk === false) softReasons.push('Retest is partial or shallow');
    if(masterScore && masterScore.score >= 75 && masterScore.score < 85) softReasons.push('Master score is entry-ready but not high-confidence');

    const score = decisionState ? decisionState.entryReadinessScore || 0 : 0;
    const grade = hardReasons.length ? 'D'
      : masterScore && masterScore.score >= 92 && score >= 90 && !softReasons.length ? 'A+'
        : masterScore && masterScore.score >= 85 && score >= 80 ? 'A'
          : score >= 90 && !softReasons.length ? 'A+'
        : score >= 80 && softReasons.length <= 1 ? 'A'
          : score >= 70 && softReasons.length <= 1 ? 'B+'
            : score >= 55 ? 'B'
              : 'C';
    return {
      grade,
      committable:['A+','A','B+'].includes(grade),
      hardReasons,
      softReasons,
      summary:hardReasons[0] || softReasons[0] || 'All grade checks passed'
    };
  }

  function buildMasterScore(setup, analysis, candleBehavior, liquidityMap, locationContext, volumeContext, htfAlignment, sessionRules, decisionState){
    const side = setup && setup.direction;
    const structure = {
      htfAligned:setup && setup.htfOk !== false ? 10 : 0,
      bosConfirmed:decisionState && decisionState.directionalStructure ? 8 : 0,
      chochConviction:analysis.market && analysis.market.choch ? 7 : decisionState && decisionState.directionalCandle ? 5 : 0,
      swingFresh:analysis.market && analysis.market.swings && analysis.market.swings.length ? 5 : 0
    };
    const lastSweep = (analysis.liquidity.stopHunts || []).slice(-1)[0];
    const liquidity = {
      cleanSweep:lastSweep ? 10 : liquidityMap && liquidityMap.actionableNearest && liquidityMap.actionableNearest.length ? 6 : 0,
      orderBlock:locationContext && locationContext.orderBlocks && ((side === 'LONG' && locationContext.orderBlocks.long) || (side === 'SHORT' && locationContext.orderBlocks.short)) ? 8 : setup && setup.locationOk !== false ? 5 : 0,
      fvg:locationContext && locationContext.fvg && ((side === 'LONG' && locationContext.fvg.long) || (side === 'SHORT' && locationContext.fvg.short)) ? 7 : setup && setup.liquidityPathOk !== false ? 5 : 0
    };
    const confluence = {
      premiumDiscount:setup && setup.locationOk !== false ? 8 : 0,
      rsiDivergence:setup && setup.trendOk !== false ? 7 : 0,
      sessionActive:sessionRules && setup && setup.sessionOk !== false ? 6 : 0,
      volumeConfirmation:volumeContext && volumeContext.confirmsBreakout ? 4 : 0
    };
    const candle = {
      rejectionWick:candleBehavior && candleBehavior.wickRatios && Math.max(candleBehavior.wickRatios.upper, candleBehavior.wickRatios.lower) >= 1.5 ? 8 : 0,
      engulfingConfirmed:candleBehavior && candleBehavior.engulfing && candleBehavior.engulfing.confirmed ? 7 : candleBehavior && candleBehavior.strengthScore >= 70 ? 5 : 0,
      deltaPositive:setup && setup.deltaOk !== false && candleBehavior && ((side === 'LONG' && candleBehavior.delta >= 0) || (side === 'SHORT' && candleBehavior.delta <= 0)) ? 5 : 0
    };
    const structureScore = Object.values(structure).reduce((a,b)=>a+b,0);
    const liquidityScore = Object.values(liquidity).reduce((a,b)=>a+b,0);
    const confluenceScore = Object.values(confluence).reduce((a,b)=>a+b,0);
    const candleScore = Object.values(candle).reduce((a,b)=>a+b,0);
    const score = Math.round(clamp(structureScore + liquidityScore + confluenceScore + candleScore, 0, 100));
    const tier = score >= 92 ? 'ELITE_SETUP' : score >= 85 ? 'HIGH_CONFIDENCE' : score >= 75 ? 'ENTRY_READY' : score >= 60 ? 'WATCH' : 'BLOCKED';
    return {
      score,
      tier,
      structure:{score:structureScore, max:30, details:structure},
      liquidity:{score:liquidityScore, max:25, details:liquidity},
      confluence:{score:confluenceScore, max:25, details:confluence},
      candleQuality:{score:candleScore, max:20, details:candle}
    };
  }

  function buildAiAdvisor(decision){
    const setup = decision.setup || {};
    const plan = decision.tradePlan;
    const side = plan ? plan.side : setup.direction;
    const master = decision.masterScore || {};
    const forecast = decision.nextStepForecast || {};
    const formation = decision.formationPlan || {};
    const candle = decision.candleBehavior || {};
    const liquidity = decision.liquidityMap || {};
    const nearest = (liquidity.actionableNearest || liquidity.nearest || [])[0] || null;
    const reasons = [];
    const nextActions = [];
    const warnings = [];
    let posture = 'WAIT';
    let primaryIdea = 'No clean trade idea yet';
    let oppositeScenario = 'Opposite scenario is not defined yet';

    if(decision.tradeStatus === 'BLOCKED' || master.tier === 'BLOCKED'){
      posture = 'BLOCK';
      reasons.push('The engine does not have enough aligned proof for a committed trade.');
    } else if(decision.signalGrade && decision.signalGrade.committable && plan){
      posture = master.score >= 85 ? 'HIGH_CONFIDENCE' : 'ENTRY_READY';
      reasons.push(`${side} has enough alignment for demo consideration, but it still needs disciplined execution.`);
    } else if(setup.direction || formation.side){
      posture = 'WATCH';
      reasons.push('A setup is forming, but the trigger is not mature enough for auto-commit.');
    }

    if(side && setup.setup){
      primaryIdea = `${side} ${setup.setup}`;
    } else if(formation.side){
      primaryIdea = `${formation.side} formation watch`;
    } else if(forecast.expectation){
      primaryIdea = forecast.expectation;
    }

    if(side === 'LONG'){
      oppositeScenario = 'If price fails to reclaim sell-side liquidity or prints bearish BOS, long idea is invalid and short continuation can take control.';
    } else if(side === 'SHORT'){
      oppositeScenario = 'If price reclaims buy-side liquidity or prints bullish BOS, short idea is invalid and long reversal can take control.';
    } else {
      oppositeScenario = 'Wait for either a clean sweep/reclaim or a confirmed BOS before choosing direction.';
    }

    if(decision.tradeStatus === 'BLOCKED') warnings.push(...(decision.reason || []).slice(0, 2));
    if(decision.signalGrade && decision.signalGrade.hardReasons && decision.signalGrade.hardReasons.length){
      warnings.push(...decision.signalGrade.hardReasons.slice(0, 3));
    }
    if(candle.bullishTrap) warnings.push('Bullish candle has negative estimated delta; avoid buying into a possible trap.');
    if(candle.bearishTrap) warnings.push('Bearish candle has positive estimated delta; avoid shorting into a possible trap.');
    if(setup.liquidityPathOk === false) warnings.push('Nearest liquidity is directly in the trade path; wait for sweep/reaction.');
    if(candle.momentum && candle.momentum.exhaustionRisk === 'HIGH') warnings.push('Four or more same-direction candles suggest exhaustion risk; wait for pause/retest.');
    if(nearest && !warnings.length) warnings.push(`Nearest actionable liquidity is ${nearest.type} near ${round(nearest.price, priceDigits(nearest.price))}.`);

    if(plan && decision.signalGrade && decision.signalGrade.committable){
      nextActions.push(`Entry only inside ${round(plan.entryZone[0], priceDigits(plan.entry))}-${round(plan.entryZone[1], priceDigits(plan.entry))}; invalid below/above ${round(plan.stopLoss, priceDigits(plan.stopLoss))}.`);
      if(plan.takeProfit) nextActions.push(`Manage dynamically: TP1 ${round(plan.takeProfit.tp1, priceDigits(plan.entry))}, then breakeven and runner toward TP2/TP3.`);
    } else {
      nextActions.push(...(decision.nextConditionNeeded || []).slice(0, 3));
      if(forecast.nextCandleMust) nextActions.push(forecast.nextCandleMust);
      if(formation.trigger) nextActions.push(formation.trigger);
    }

    const summary = `${posture}: ${primaryIdea}. ${warnings[0] ? `Main warning: ${warnings[0]}` : 'No immediate execution edge yet.'}`;
    return {
      posture,
      primaryIdea,
      confidence:master.score || 0,
      summary,
      why:(reasons.length ? reasons : ['GoldPilot is waiting for stronger confluence.']).slice(0, 4),
      mistakeWarning:[...new Set(warnings)].slice(0, 5),
      nextBestActions:[...new Set(nextActions.filter(Boolean))].slice(0, 5),
      oppositeScenario,
      tone:posture === 'BLOCK' ? 'defensive' : posture === 'WATCH' ? 'patient' : 'execution-ready'
    };
  }

  function recentLow(candles, count){
    let low = Infinity;
    for(let i=Math.max(0, candles.length-count); i<candles.length; i++) low = Math.min(low, candles[i].l);
    return low;
  }

  function recentHigh(candles, count){
    let high = -Infinity;
    for(let i=Math.max(0, candles.length-count); i<candles.length; i++) high = Math.max(high, candles[i].h);
    return high;
  }

  function buildStopCandidates(candles, side, entry, atr){
    const last = candles[candles.length-1];
    const prev = candles[candles.length-2] || last;
    const minDistance = Math.max(atr * 0.12, entry * 0.0004);
    const raw = side === 'LONG'
      ? [
          {source:'Recent swing/sweep low', price:recentLow(candles, 20) - atr * 0.15, reason:'Below recent swing/sweep low'},
          {source:'Local structure low', price:recentLow(candles, 8) - atr * 0.08, reason:'Below local structure low'},
          {source:'Retest/rejection wick low', price:Math.min(last.l, prev.l) - atr * 0.04, reason:'Below retest/rejection wick'}
        ]
      : [
          {source:'Recent swing/sweep high', price:recentHigh(candles, 20) + atr * 0.15, reason:'Above recent swing/sweep high'},
          {source:'Local structure high', price:recentHigh(candles, 8) + atr * 0.08, reason:'Above local structure high'},
          {source:'Retest/rejection wick high', price:Math.max(last.h, prev.h) + atr * 0.04, reason:'Above retest/rejection wick'}
        ];
    return raw.filter(candidate => {
      const distance = Math.abs(entry - candidate.price);
      return side === 'LONG'
        ? candidate.price < entry && distance >= minDistance
        : candidate.price > entry && distance >= minDistance;
    });
  }

  function rewardDistance(side, entry, targetPrice){
    if(targetPrice == null) return 0;
    return side === 'LONG' ? targetPrice - entry : entry - targetPrice;
  }

  function addTargetCandidate(targets, side, entry, target){
    if(!target || target.price == null || !isFinite(target.price)) return;
    const reward = rewardDistance(side, entry, target.price);
    if(reward <= 0) return;
    if(targets.some(t => Math.abs(t.price - target.price) / (entry || 1) < 0.00035)) return;
    targets.push(Object.assign({weight:50}, target, {rewardDistance:reward}));
  }

  function buildTargetCandidates(candles, analysis, side, entry, liquidityMap, atr){
    const targets = [];
    const recent30High = recentHigh(candles, 30);
    const recent30Low = recentLow(candles, 30);
    const recent80High = recentHigh(candles, Math.min(80, candles.length));
    const recent80Low = recentLow(candles, Math.min(80, candles.length));
    const step = roundNumberStep(entry);
    const roundBelow = Math.floor(entry / step) * step;
    const roundAbove = roundBelow + step;

    for(const level of liquidityMap.actionableNearest || []){
      if(level.minor || level.actionable === false) continue;
      addTargetCandidate(targets, side, entry, {
        name:level.name || level.type || 'Nearby liquidity',
        type:level.type || 'liquidity',
        price:level.price,
        weight:level.touches ? 55 + Math.min(level.touches * 5, 20) : 50
      });
    }

    if(side === 'LONG'){
      addTargetCandidate(targets, side, entry, {name:'Recent swing high', type:'structure', price:recent30High, weight:62});
      addTargetCandidate(targets, side, entry, {name:'Major range high', type:'range-extreme', price:recent80High, weight:74});
      addTargetCandidate(targets, side, entry, {name:'Round number above', type:'round-number', price:roundAbove, weight:58});
      addTargetCandidate(targets, side, entry, {name:'Extended round number above', type:'round-number', price:roundAbove + step, weight:48});
    } else {
      addTargetCandidate(targets, side, entry, {name:'Recent swing low', type:'structure', price:recent30Low, weight:62});
      addTargetCandidate(targets, side, entry, {name:'Major range low', type:'range-extreme', price:recent80Low, weight:74});
      addTargetCandidate(targets, side, entry, {name:'Round number below', type:'round-number', price:roundBelow, weight:58});
      addTargetCandidate(targets, side, entry, {name:'Extended round number below', type:'round-number', price:roundBelow - step, weight:48});
    }

    const zones = (analysis.zones && analysis.zones.zones || []).slice(-10);
    for(const z of zones){
      if(side === 'LONG' && z.dir === 'supply'){
        addTargetCandidate(targets, side, entry, {name:'Supply zone target', type:'supply', price:z.low, weight:66});
      }
      if(side === 'SHORT' && z.dir === 'demand'){
        addTargetCandidate(targets, side, entry, {name:'Demand zone target', type:'demand', price:z.high, weight:66});
      }
    }

    const minDistance = atr * 0.15;
    return targets
      .filter(t => t.rewardDistance > minDistance)
      .map(t => Object.assign({}, t, {
        significance:t.weight + Math.min((t.rewardDistance / (atr || entry * 0.002)) * 4, 28)
      }))
      .sort((a,b) => a.rewardDistance - b.rewardDistance);
  }

  function buildTradePlan(candles, analysis, setup, liquidityMap){
    if(!setup.direction) return null;
    const last = candles[candles.length-1];
    const atr = calculateAtr(candles, 14) || candleRange(last) || last.c * 0.002;
    const side = setup.direction;
    const entry = last.c;
    const stopCandidates = buildStopCandidates(candles, side, entry, atr);
    const fallbackStop = side === 'LONG'
      ? {source:'Fallback swing low', price:findRecentLow(candles) - atr * 0.15, reason:'Below recent swing/sweep low'}
      : {source:'Fallback swing high', price:findRecentHigh(candles) + atr * 0.15, reason:'Above recent swing/sweep high'};
    if(!stopCandidates.length) stopCandidates.push(fallbackStop);
    const allTargets = buildTargetCandidates(candles, analysis, side, entry, liquidityMap, atr);
    const evaluatedStops = stopCandidates.map(candidate => {
      const riskDistance = Math.abs(entry - candidate.price);
      const actionableTargets = allTargets.filter(target => target.rewardDistance / riskDistance >= CONFIG.minRiskReward);
      const minorTargets = allTargets.filter(target => target.rewardDistance / riskDistance < CONFIG.minRiskReward);
      const selectedTarget = actionableTargets[0] || allTargets[0] || null;
      const rr = riskDistance && selectedTarget ? selectedTarget.rewardDistance / riskDistance : 0;
      return Object.assign({}, candidate, {riskDistance, rr, selectedTarget, actionableTargets, minorTargets});
    }).sort((a,b) => {
      const aPass = a.rr >= CONFIG.minRiskReward ? 1 : 0;
      const bPass = b.rr >= CONFIG.minRiskReward ? 1 : 0;
      if(aPass !== bPass) return bPass - aPass;
      return b.rr - a.rr;
    });
    const selectedStop = evaluatedStops[0] || fallbackStop;
    const stop = selectedStop.price;
    const invalidationReason = selectedStop.reason;
    const riskDistance = Math.abs(entry - stop);
    const actionableTargets = selectedStop.actionableTargets || [];
    const minorTargets = selectedStop.minorTargets || [];
    const firstTarget = actionableTargets[0] || selectedStop.selectedTarget || null;
    const secondTarget = actionableTargets[1] || allTargets.find(t => firstTarget && t.price !== firstTarget.price && t.rewardDistance > firstTarget.rewardDistance) || null;
    const atrTp1 = side === 'LONG' ? entry + atr * 1.5 : entry - atr * 1.5;
    const targetPrices = [atrTp1, firstTarget && firstTarget.price, secondTarget && secondTarget.price]
      .filter(v => v != null && isFinite(v) && rewardDistance(side, entry, v) > 0)
      .sort((a,b) => rewardDistance(side, entry, a) - rewardDistance(side, entry, b));
    const tp1 = targetPrices[0] || null;
    const tp2 = targetPrices[1] || tp1;
    const tp3 = targetPrices[2] || tp2;
    const rr = riskDistance && firstTarget ? rewardDistance(side, entry, firstTarget.price) / riskDistance : 0;
    const digits = priceDigits(entry);
    const targetQuality = !firstTarget ? 'No confirmed target'
      : rr < CONFIG.minRiskReward ? 'Targets too close for valid R:R'
        : firstTarget.type === 'range-extreme' || firstTarget.type === 'supply' || firstTarget.type === 'demand' ? 'Major market target'
          : secondTarget ? 'Two valid market targets'
            : 'Single valid market target';
    return {
      side,
      entryZone: [round(entry - atr * 0.1,digits), round(entry + atr * 0.1,digits)],
      entry:round(entry,digits),
      invalidation:round(stop,digits),
      invalidationReason,
      stopLoss:round(stop,digits),
      takeProfit:{
        tp1:round(tp1,digits),
        tp2:round(tp2,digits),
        tp3:round(tp3,digits),
        model:'ATR_DYNAMIC',
        partials:{tp1:40,tp2:35,tp3:25},
        atr:round(atr,digits),
        breakevenAfter:'TP1',
        trail:{enabled:true, after:'TP1', atrMultiple:0.8},
        maxHoldCandles:12
      },
      riskReward:round(rr,2),
      invalidationSource:selectedStop.source,
      invalidationOptimized:selectedStop.source !== 'Recent swing/sweep low' && selectedStop.source !== 'Recent swing/sweep high',
      stopCandidates:evaluatedStops.map(candidate => ({
        source:candidate.source,
        stopLoss:round(candidate.price,digits),
        riskReward:round(candidate.rr,2)
      })),
      targetCandidates:allTargets.slice(0, 6).map(target => ({
        source:target.name || target.type || 'Market target',
        price:round(target.price,digits),
        rewardDistance:round(target.rewardDistance,digits),
        requiredReward:round(riskDistance * CONFIG.minRiskReward,digits),
        actionable:target.rewardDistance >= riskDistance * CONFIG.minRiskReward
      })),
      minorTargets:minorTargets.slice(0, 4).map(target => ({
        source:target.name || target.type || 'Minor target',
        price:round(target.price,digits),
        riskReward:round(riskDistance ? target.rewardDistance / riskDistance : 0, 2)
      })),
      targetQuality,
      targetSource:firstTarget ? firstTarget.name || firstTarget.type || 'Market target' : 'No market target',
      targetWarning:firstTarget
        ? (rr >= CONFIG.minRiskReward ? `Target hierarchy found actionable ${firstTarget.name || firstTarget.type} with 1:${round(rr,2)} R:R` : `All real targets are too close: best reward only 1:${round(rr,2)}. Wait for deeper retest or a clearer lower/higher liquidity target.`)
        : 'No valid directional liquidity/structure target found',
      marketTargetBased:true
    };
  }

  function buildEntryPlanFromPrice(candles, analysis, liquidityMap, side, entry, stop, label){
    if(!side || !isFinite(entry) || !isFinite(stop)) return null;
    const riskDistance = side === 'LONG' ? entry - stop : stop - entry;
    if(!(riskDistance > 0)) return null;
    const last = candles[candles.length-1];
    const atr = calculateAtr(candles, 14) || candleRange(last) || entry * 0.002;
    const digits = priceDigits(entry);
    const allTargets = buildTargetCandidates(candles, analysis, side, entry, liquidityMap, atr);
    const actionableTargets = allTargets.filter(target => target.rewardDistance / riskDistance >= CONFIG.minRiskReward);
    const minorTargets = allTargets.filter(target => target.rewardDistance / riskDistance < CONFIG.minRiskReward);
    const firstTarget = actionableTargets[0] || allTargets[0] || null;
    const secondTarget = actionableTargets[1] || allTargets.find(t => firstTarget && t.price !== firstTarget.price && t.rewardDistance > firstTarget.rewardDistance) || null;
    const atrTp1 = side === 'LONG' ? entry + atr * 1.5 : entry - atr * 1.5;
    const targetPrices = [atrTp1, firstTarget && firstTarget.price, secondTarget && secondTarget.price]
      .filter(v => v != null && isFinite(v) && rewardDistance(side, entry, v) > 0)
      .sort((a,b) => rewardDistance(side, entry, a) - rewardDistance(side, entry, b));
    const rr = firstTarget ? rewardDistance(side, entry, firstTarget.price) / riskDistance : 0;
    return {
      side,
      entryZone:[round(entry - atr * 0.06, digits), round(entry + atr * 0.06, digits)],
      entry:round(entry, digits),
      invalidation:round(stop, digits),
      invalidationReason:'Early trigger invalidation from formation plan',
      stopLoss:round(stop, digits),
      takeProfit:{
        tp1:round(targetPrices[0] || null, digits),
        tp2:round(targetPrices[1] || targetPrices[0] || null, digits),
        tp3:round(targetPrices[2] || targetPrices[1] || targetPrices[0] || null, digits),
        model:'ATR_DYNAMIC',
        partials:{tp1:40,tp2:35,tp3:25},
        atr:round(atr,digits),
        breakevenAfter:'TP1',
        trail:{enabled:true, after:'TP1', atrMultiple:0.8},
        maxHoldCandles:12
      },
      riskReward:round(rr, 2),
      invalidationSource:'Early trigger formation invalidation',
      invalidationOptimized:false,
      setupLabel:label || 'Early trigger',
      targetCandidates:allTargets.slice(0, 6).map(target => ({
        source:target.name || target.type || 'Market target',
        price:round(target.price,digits),
        rewardDistance:round(target.rewardDistance,digits),
        requiredReward:round(riskDistance * CONFIG.minRiskReward,digits),
        actionable:target.rewardDistance >= riskDistance * CONFIG.minRiskReward
      })),
      minorTargets:minorTargets.slice(0, 4).map(target => ({
        source:target.name || target.type || 'Minor target',
        price:round(target.price,digits),
        riskReward:round(riskDistance ? target.rewardDistance / riskDistance : 0, 2)
      })),
      targetQuality:!firstTarget ? 'No confirmed target'
        : rr < CONFIG.minRiskReward ? 'Targets too close for valid R:R'
          : secondTarget ? 'Two valid market targets' : 'Single valid market target',
      targetSource:firstTarget ? firstTarget.name || firstTarget.type || 'Market target' : 'No market target',
      targetWarning:firstTarget
        ? (rr >= CONFIG.minRiskReward ? `Early trigger has actionable ${firstTarget.name || firstTarget.type} with 1:${round(rr,2)} R:R` : `Early trigger target is too close: best reward only 1:${round(rr,2)}. Keep as watch-only.`)
        : 'No valid directional liquidity/structure target found',
      marketTargetBased:true,
      earlyTrigger:true
    };
  }

  function evaluateEarlyTrigger(candles, analysis, candleBehavior, liquidityMap, formationPlan, directional, bias, locationContext, cryptoContext, context){
    if(!formationPlan || !formationPlan.active || formationPlan.phase !== 'EARLY_FORMING' || !formationPlan.side || !formationPlan.earlyEntryZone){
      return {
        active:false,
        ready:false,
        stage:'NO_EARLY_TRIGGER',
        reasons:['No aligned early formation is active']
      };
    }
    const side = formationPlan.side;
    const last = candles[candles.length-1];
    const prev = candles[candles.length-2] || last;
    const atr = calculateAtr(candles, 14) || candleRange(last) || last.c * 0.002;
    const avgBody = sma(candles.slice(-14).map(candleBody), 14) || candleBody(last) || atr * 0.35;
    const zone = formationPlan.earlyEntryZone.map(Number).sort((a,b) => a-b);
    const watched = Number(formationPlan.watchedLevel || (zone[0] + zone[1]) / 2);
    const invalidation = Number(formationPlan.invalidation);
    const sideCandidate = side === 'LONG' ? directional.long : directional.short;
    const oppositeCandidate = side === 'LONG' ? directional.short : directional.long;
    const body = candleBody(last);
    const range = candleRange(last) || atr;
    const upperWick = last.h - Math.max(last.o, last.c);
    const lowerWick = Math.min(last.o, last.c) - last.l;
    const exactInteraction = side === 'LONG'
      ? last.l <= watched || prev.l <= watched
      : last.h >= watched || prev.h >= watched;
    const touchedWatched = side === 'LONG'
      ? exactInteraction || last.l <= watched + atr * 0.12 || prev.l <= watched + atr * 0.12
      : exactInteraction || last.h >= watched - atr * 0.12 || prev.h >= watched - atr * 0.12;
    const closedAway = side === 'LONG'
      ? last.c > watched && last.c > last.o
      : last.c < watched && last.c < last.o;
    const rejection = side === 'LONG'
      ? lowerWick >= body * 0.65 || candleBehavior.rejectionScore >= 58
      : upperWick >= body * 0.65 || candleBehavior.rejectionScore >= 58;
    const decisiveBody = body >= avgBody * 0.85 || body / range >= 0.45 || candleBehavior.strengthScore >= 58;
    const notChased = side === 'LONG'
      ? last.c <= Math.max(zone[1], watched) + atr * 0.55
      : last.c >= Math.min(zone[0], watched) - atr * 0.55;
    const validStop = side === 'LONG' ? invalidation < last.c : invalidation > last.c;
    const counterBias = !!(sideCandidate && sideCandidate.counterBias);
    const oppositeStrong = !!(oppositeCandidate && oppositeCandidate.entryReadinessScore >= 80 && !oppositeCandidate.counterBias);
    const higherTfOpposes = !!(bias && ((side === 'LONG' && bias.bias === 'Bearish') || (side === 'SHORT' && bias.bias === 'Bullish')));
    const higherTfSupports = !!(bias && ((side === 'LONG' && bias.bias === 'Bullish') || (side === 'SHORT' && bias.bias === 'Bearish')));
    const needsActualTouch = formationPlan.source === 'liquidity-approach';
    const rangeZone = locationContext && locationContext.range ? locationContext.range.zone : 'Unknown';
    const poorEarlyLocation = needsActualTouch && (
      (side === 'SHORT' && rangeZone === 'Discount') ||
      (side === 'LONG' && rangeZone === 'Premium')
    );
    const liquidationWickRisk = !!(needsActualTouch && cryptoContext && cryptoContext.wickSweep);
    const reasons = [];
    let score = 45;

    if(touchedWatched){ score += 12; reasons.push('price interacted with the watched liquidity/zone'); }
    else reasons.push('watched liquidity/zone has not been interacted with yet');
    if(closedAway){ score += 18; reasons.push(`${side} trigger candle closed away from the watched level`); }
    else reasons.push(`wait for candle close in ${side} direction away from watched level`);
    if(rejection){ score += 10; reasons.push('wick/rejection behavior supports the early trigger'); }
    else reasons.push('rejection candle is not strong enough yet');
    if(decisiveBody){ score += 10; reasons.push('trigger candle body is strong enough'); }
    else reasons.push('trigger candle body is still weak');
    if(notChased){ score += 8; reasons.push('entry is not too far from the trigger zone'); }
    else reasons.push('move is already extended from the trigger zone');
    if(validStop){ score += 7; }
    else reasons.push('formation invalidation is on the wrong side of current price');
    if(counterBias){ score -= 18; reasons.push('early trigger is counter-bias, so it stays watch-only'); }
    if(oppositeStrong){ score -= 12; reasons.push('opposite side still has strong readiness'); }
    if(needsActualTouch && !exactInteraction){ score -= 18; reasons.push('liquidity approach needs an actual touch/sweep before early entry'); }
    if(needsActualTouch && !higherTfSupports){ score -= 24; reasons.push('liquidity-approach early trigger needs higher-timeframe directional support'); }
    if(needsActualTouch && higherTfOpposes){ score -= 12; reasons.push('liquidity-approach early trigger is fighting higher-timeframe bias'); }
    if(poorEarlyLocation && !rejection){ score -= 22; reasons.push(`${side} early trigger is in ${rangeZone}; require real rejection, not only momentum`); }
    if(poorEarlyLocation && rejection){ score -= 35; reasons.push(`${side} early trigger is in ${rangeZone}; late-location liquidity triggers stay watch-only`); }
    if(liquidationWickRisk){ score -= 20; reasons.push('large liquidation-style wick keeps early trigger watch-only'); }
    if(context && context.newsBlock){ score = 0; reasons.push('news block prevents early trigger'); }

    score = Math.round(clamp(score, 0, 100));
    const plan = buildEntryPlanFromPrice(candles, analysis, liquidityMap, side, last.c, invalidation, `${side} early liquidity trigger`);
    const targetOk = !!(plan && plan.riskReward >= CONFIG.minRiskReward);
    const hasRequiredCandleProof = needsActualTouch ? rejection : (rejection || decisiveBody);
    const ready = score >= 78 && touchedWatched && (!needsActualTouch || exactInteraction) && closedAway && hasRequiredCandleProof && !poorEarlyLocation && !liquidationWickRisk && notChased && validStop && !counterBias && !oppositeStrong && (!needsActualTouch || higherTfSupports) && targetOk;
    return {
      active:true,
      ready,
      stage:ready ? 'EARLY_VALID' : 'EARLY_WAIT',
      side,
      score,
      entryMode:'trigger-close',
      watchedLevel:formationPlan.watchedLevel,
      requiredConditions:[
        'touch/sweep watched liquidity or zone',
        `close ${side === 'LONG' ? 'above' : 'below'} watched level`,
        needsActualTouch ? 'show real rejection at the watched liquidity/zone' : 'show rejection or decisive body',
        'keep current entry close to trigger zone',
        'use valid formation invalidation',
        'market target must give at least 1:2 R:R'
      ],
      reasons:[...new Set(reasons)],
      tradePlan:plan,
      riskReward:plan ? plan.riskReward : 0,
      targetOk
    };
  }

  function calculateRiskPermission(plan, account){
    if(!plan) return {allowed:false, reason:'No actionable trade plan'};
    const balance = Number(account.balance || 0);
    const riskPct = Number(account.riskPct || CONFIG.defaultRiskPct);
    const tickValuePerLot = Number(account.tickValuePerLot || 100);
    const minLot = Number(account.minLot || 0.01);
    const riskCash = balance ? balance * riskPct / 100 : null;
    const slDistance = Math.abs(plan.entry - plan.stopLoss);
    const lotSize = riskCash && slDistance ? riskCash / (slDistance * tickValuePerLot) : null;
    const roundedLot = lotSize == null ? null : Math.floor(lotSize * 100) / 100;
    const minLotLoss = slDistance * tickValuePerLot * minLot;
    const reasons = [];
    let allowed = true;
    if(plan.riskReward < CONFIG.minRiskReward){ allowed = false; reasons.push(`R:R ${plan.riskReward} is below minimum ${CONFIG.minRiskReward}`); }
    if(balance && roundedLot !== null && roundedLot < minLot){
      allowed = false;
      reasons.push(`Calculated size ${round(lotSize,4)} is below minimum ${minLot}; minimum size would risk $${round(minLotLoss,2)}`);
    }
    if(account.dailyLossHit){ allowed = false; reasons.push('Daily loss limit has been hit'); }
    if(account.maxTradesHit){ allowed = false; reasons.push('Maximum trades for the day reached'); }
    return {
      allowed,
      balance:balance || null,
      riskPct,
      maxLoss:riskCash == null ? null : round(riskCash,2),
      slDistance:round(slDistance,2),
      lotSize:roundedLot,
      minLot,
      tickValuePerLot,
      minLotLoss:round(minLotLoss,2),
      sizingMode:account.sizingMode || 'LOT_VALUE',
      reasons:reasons.length ? reasons : ['Risk rules permit this idea']
    };
  }

  function buildDecision(input){
    const context = normalizeDecisionInput(input);
    const candles = context.primaryCandles;
    if(!candles || candles.length < 5){
      return {tradeStatus:'WAIT', reason:['Not enough candle data for market structure'], nextConditionNeeded:['Load more XAUUSD candles']};
    }

    const analysis = analyzeMarket(candles);
    const tradability = evaluateTradability(candles, context);
    const regime = classifyRegime(analysis, candles, tradability);
    const bias = buildMultiTimeframeBias(context.timeframes);
    const candleBehavior = analyzeCandleBehavior(candles);
    const liquidityMap = buildLiquidityMap(candles, analysis);
    const locationContext = buildLocationContext(candles, analysis);
    const volumeContext = analyzeVolumeContext(candles);
    const trendQuality = buildTrendQuality(candles, analysis);
    const cryptoContext = buildCryptoContext(candles, context);
    const htfAlignment = buildHtfZoneAlignment(context, candles);
    const sessionRules = buildSessionRules(tradability, regime, volumeContext, candleBehavior);
    let setup = detectSetupFormation(analysis, candleBehavior, bias, regime);
    const directional = buildDirectionalCandidates(candles, analysis, candleBehavior, bias, regime, tradability, liquidityMap, locationContext, volumeContext, trendQuality, cryptoContext, htfAlignment, sessionRules, context.account);
    const preferredDirection = choosePreferredDirection(directional.long, directional.short);
    if(preferredDirection === 'LONG' && directional.long.setup){
      setup = {
        setup:directional.long.setup,
        direction:'LONG',
        quality:directional.long.quality,
        counterBias:directional.long.counterBias,
        locationOk:directional.long.locationOk,
        locationZone:directional.long.locationZone,
        volumeOk:directional.long.volumeOk,
        trendOk:directional.long.trendOk,
        cryptoOk:directional.long.cryptoOk,
        liquidityPathOk:directional.long.liquidityPathOk,
        deltaOk:directional.long.deltaOk,
        wickRejectionOk:directional.long.wickRejectionOk,
        pathLiquidity:directional.long.pathLiquidity,
        retestOk:directional.long.retestOk,
        retestContext:directional.long.retestContext,
        htfOk:directional.long.htfOk,
        sessionOk:directional.long.sessionOk,
        reasons:directional.long.reasons,
        needsConfirmation:directional.long.needsConfirmation
      };
    } else if(preferredDirection === 'SHORT' && directional.short.setup){
      setup = {
        setup:directional.short.setup,
        direction:'SHORT',
        quality:directional.short.quality,
        counterBias:directional.short.counterBias,
        locationOk:directional.short.locationOk,
        locationZone:directional.short.locationZone,
        volumeOk:directional.short.volumeOk,
        trendOk:directional.short.trendOk,
        cryptoOk:directional.short.cryptoOk,
        liquidityPathOk:directional.short.liquidityPathOk,
        deltaOk:directional.short.deltaOk,
        wickRejectionOk:directional.short.wickRejectionOk,
        pathLiquidity:directional.short.pathLiquidity,
        retestOk:directional.short.retestOk,
        retestContext:directional.short.retestContext,
        htfOk:directional.short.htfOk,
        sessionOk:directional.short.sessionOk,
        reasons:directional.short.reasons,
        needsConfirmation:directional.short.needsConfirmation
      };
    }
    setup.counterBias = !!setup.counterBias;
    if(setup.direction && setup.locationOk === false && setup.needsConfirmation){
      const waitFor = setup.direction === 'LONG'
        ? 'Wait for discount/FVG/order-block retest or sell-side sweep before long'
        : 'Wait for premium/FVG/order-block retest or buy-side sweep before short';
      setup.needsConfirmation = [...new Set([...setup.needsConfirmation, waitFor])];
    }
    const plan = buildTradePlan(candles, analysis, setup, liquidityMap);
    const risk = calculateRiskPermission(plan, context.account);
    const decisionState = evaluateDecisionState(analysis, setup, candleBehavior, tradability, risk, plan);
    const masterScore = buildMasterScore(setup, analysis, candleBehavior, liquidityMap, locationContext, volumeContext, htfAlignment, sessionRules, decisionState);
    const signalGrade = buildSignalGrade(setup, plan, risk, decisionState, masterScore);
    const directionalStructure = hasDirectionalStructure(analysis, setup.direction);
    const nextStepForecast = buildNextStepForecast(analysis, candleBehavior, bias, regime, liquidityMap, directional.long, directional.short);
    const formationPlan = buildFormationPlan(candles, analysis, bias, liquidityMap, locationContext, htfAlignment, sessionRules);
    const earlyTrigger = evaluateEarlyTrigger(candles, analysis, candleBehavior, liquidityMap, formationPlan, directional, bias, locationContext, cryptoContext, context);
    const earlyRisk = earlyTrigger.tradePlan ? calculateRiskPermission(earlyTrigger.tradePlan, context.account) : null;
    const earlyCommittable = !!(earlyTrigger.ready && earlyRisk && earlyRisk.allowed && masterScore.score >= 75);
    let outputPlan = plan;
    let outputRisk = risk;
    let outputSignalGrade = signalGrade;
    if(earlyCommittable && !signalGrade.committable){
      outputPlan = earlyTrigger.tradePlan;
      outputRisk = earlyRisk;
      outputSignalGrade = {
        grade:earlyTrigger.score >= 88 ? 'A' : 'B+',
        committable:true,
        label:'Early validated trigger',
        reasons:[
          `Early trigger score ${earlyTrigger.score}`,
          'Trigger candle confirmed before full BOS/retest sequence',
          earlyTrigger.tradePlan.targetWarning
        ].filter(Boolean)
      };
    }

    let tradeStatus = 'WAIT';
    const reason = [];
    const nextConditionNeeded = [];
    if(tradability.status === 'BLOCKED'){
      tradeStatus = 'BLOCKED';
      reason.push(...tradability.reasons);
      nextConditionNeeded.push('Wait until news/spread/volatility conditions normalize');
    } else if(earlyCommittable && !signalGrade.committable){
      tradeStatus = 'EARLY VALID';
      reason.push(`${earlyTrigger.side} early trigger confirmed from liquidity/zone reaction`);
      reason.push(...earlyTrigger.reasons.slice(0, 4));
      nextConditionNeeded.push('Demo commit only: manage from trigger-close entry and fixed invalidation');
    } else if(!setup.direction){
      if(setup.setup) tradeStatus = 'WATCH ONLY';
      reason.push('No valid setup is confirmed');
      nextConditionNeeded.push(...(setup.needsConfirmation.length ? setup.needsConfirmation : ['Wait for sweep, BOS/CHOCH, or retest confirmation']));
    } else if(decisionState.setupStage === 'WATCH_ONLY'){
      tradeStatus = 'WATCH ONLY';
      reason.push(...(setup.reasons.length ? setup.reasons : ['Setup is watch-only']));
      nextConditionNeeded.push(...decisionState.missingConditions);
    } else if(!directionalStructure){
      tradeStatus = 'SETUP FORMING';
      reason.push('Setup is forming, but matching structure confirmation is not complete');
      nextConditionNeeded.push(...decisionState.missingConditions);
    } else if(!risk.allowed){
      tradeStatus = 'BLOCKED';
      reason.push(...risk.reasons);
      if(plan && plan.riskReward < CONFIG.minRiskReward){
        nextConditionNeeded.push('Do not force this trade. Wait for a deeper retest, tighter valid invalidation, or a better market target.');
        if(plan.targetWarning) nextConditionNeeded.push(plan.targetWarning);
      } else {
        nextConditionNeeded.push('Skip trade or reduce risk after a valid recalculation');
      }
    } else if(decisionState.setupStage === 'ENTRY_READY'){
      tradeStatus = 'ENTRY READY';
      reason.push(...setup.reasons, 'Entry trigger is ready, waiting for trader confirmation');
    } else if(signalGrade.committable){
      tradeStatus = `${signalGrade.grade} READY`;
      reason.push(...setup.reasons, `${signalGrade.grade} grade setup is valid for demo commit`);
    } else if(setup.direction){
      tradeStatus = 'SETUP FORMING';
      reason.push(...(setup.reasons.length ? setup.reasons : ['Setup is forming']));
      nextConditionNeeded.push(...decisionState.missingConditions);
    } else {
      tradeStatus = `${setup.direction} ALLOWED`;
      reason.push(...setup.reasons, ...risk.reasons);
    }

    if(liquidityMap.warning && tradeStatus !== 'BLOCKED') reason.push(liquidityMap.warning);
    if(cryptoContext.warnings && cryptoContext.warnings.length && tradeStatus !== 'BLOCKED') reason.push(...cryptoContext.warnings.slice(0, 2));

    const decisionOutput = {
      product:'GoldPilot AI',
      tradeStatus,
      bias,
      tradability,
      regime,
      liquidityMap,
      locationContext,
      volumeContext,
      trendQuality,
      cryptoContext,
      htfAlignment,
      sessionRules,
      chartStructure:analysis.market,
      candleBehavior,
      nextStepForecast,
      formationPlan,
      earlyTrigger,
      setup,
      longSetup:directional.long,
      shortSetup:directional.short,
      preferredDirection,
      setupStage:decisionState.setupStage,
      masterScore,
      signalGrade:outputSignalGrade,
      missingConditions:decisionState.missingConditions,
      entryReadinessScore:decisionState.entryReadinessScore,
      blockedReasons:decisionState.blockedReasons,
      allowedActions:decisionState.allowedActions,
      entryTrigger:{
        ready:tradeStatus.indexOf('ALLOWED') > -1 || tradeStatus === 'ENTRY READY' || outputSignalGrade.committable,
        type:earlyCommittable && !signalGrade.committable
          ? `${outputSignalGrade.grade} grade | ${earlyTrigger.side} early trigger-close entry`
          : setup.direction ? `${outputSignalGrade.grade} grade | ${directionalStructure ? `${setup.direction} BOS/CHOCH close confirmation` : 'Sweep/retest watch'}` : null
      },
      tradePlan:outputPlan,
      risk:outputRisk,
      management: outputPlan ? [
        'Do not move SL emotionally',
        'Take partial profit at TP1 if reached',
        'Move SL to breakeven only after TP1 or a valid structure shift',
        'Exit if opposite structure forms'
      ] : [],
      reason,
      nextConditionNeeded,
      rawAnalysis:analysis
    };
    decisionOutput.aiAdvisor = buildAiAdvisor(decisionOutput);
    return decisionOutput;
  }

  function candlesLast(candles){ return candles[candles.length-1].c; }
  function findRecentLow(c){ let low=Infinity; for(let i=Math.max(0,c.length-20);i<c.length;i++) low=Math.min(low,c[i].l); return low; }
  function findRecentHigh(c){ let high=-Infinity; for(let i=Math.max(0,c.length-20);i<c.length;i++) high=Math.max(high,c[i].h); return high; }

  function analyzeMarket(candles){
    const market = detectMarketStructure(candles);
    const liquidity = detectLiquidity(candles);
    const zones = detectZones(candles);
    const confirmation = detectConfirmation(candles);
    const engines = {market,liquidity,zones,confirmation,candles};
    const signal = generateSignal(engines);
    return {market,liquidity,zones,confirmation,signal};
  }

  const TradingEngines = {analyzeMarket, analyzeGoldPilot:buildDecision};
  if(typeof globalThis !== 'undefined') globalThis.TradingEngines = TradingEngines;
  if(typeof window !== 'undefined') window.TradingEngines = TradingEngines;
  if(typeof module !== 'undefined' && module.exports) module.exports = TradingEngines;
})();
