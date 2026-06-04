(function(){
  const CONFIG = {
    symbol: 'PAXGUSDT',
    displayName: 'PAXGUSDT gold proxy',
    primaryTimeframe: '15m',
    refreshMs: 60000,
    candlesLimit: 240,
    account: {
      balance: 1000,
      riskPct: 1,
      minLot: 0.01,
      tickValuePerLot: 1,
      maxDailyLossPct: 3,
      maxTradesPerDay: 3
    }
  };

  const TIMEFRAMES = [
    ['1M', '1m'],
    ['5M', '5m'],
    ['15M', '15m'],
    ['1H', '1h'],
    ['4H', '4h'],
    ['D', '1d']
  ];
  const WATCHLIST_SYMBOLS = [
    'PAXGUSDT','BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
    'ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','MATICUSDT','DOTUSDT'
  ];

  let candlesByTimeframe = {};
  let latestTicker = null;
  let refreshTimer = null;
  let watchlistTimer = null;
  let activeTimeframe = '15M';
  let settings = loadSettings();
  let lastDecision = null;
  let lastJournalSignature = null;
  let watchlistRows = [];
  let chartScale = null;
  let liveNewsEvents = [];
  let liveNewsFetchedAt = 0;
  let newsSourceStatus = 'Manual';

  function qs(selector){ return document.querySelector(selector); }
  function qsa(selector){ return Array.from(document.querySelectorAll(selector)); }
  function fmt(value, digits=2){
    if(value == null || !isFinite(Number(value))) return '-';
    return Number(value).toLocaleString('en-US', {minimumFractionDigits:digits, maximumFractionDigits:digits});
  }
  function priceDigits(value){
    const p = Math.abs(Number(value) || 0);
    if(p >= 1000) return 2;
    if(p >= 100) return 3;
    if(p >= 1) return 4;
    if(p >= 0.1) return 5;
    if(p >= 0.01) return 6;
    return 8;
  }
  function fmtPrice(value){
    if(value == null || !isFinite(Number(value))) return '-';
    return fmt(value, priceDigits(value));
  }
  function pct(value){
    if(value == null || !isFinite(Number(value))) return '-';
    const n = Number(value);
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  }
  function setText(selector, text){
    const el = qs(selector);
    if(el) el.textContent = text;
  }
  function setHtml(selector, html){
    const el = qs(selector);
    if(el) el.innerHTML = html;
  }

  function mobileAlertsEnabled(){
    return localStorage.getItem('goldpilotMobileAlerts') === 'enabled';
  }

  function syncMobileAlertButton(){
    const btn = qs('#enable-mobile-alerts');
    if(!btn) return;
    btn.classList.remove('active', 'blocked');
    if(!('Notification' in window)){
      btn.textContent = 'Alerts N/A';
      btn.classList.add('blocked');
      return;
    }
    if(Notification.permission === 'denied'){
      btn.textContent = 'Alerts Blocked';
      btn.classList.add('blocked');
      return;
    }
    if(mobileAlertsEnabled() && Notification.permission === 'granted'){
      btn.textContent = 'Alerts On';
      btn.classList.add('active');
    } else {
      btn.textContent = 'Alerts';
    }
  }

  function showMobileAlertStrip(title, body){
    const strip = qs('#mobile-alert-strip');
    if(!strip) return;
    const t = strip.querySelector('.mobile-alert-title');
    const b = strip.querySelector('.mobile-alert-body');
    if(t) t.textContent = title;
    if(b) b.textContent = body;
    strip.classList.add('show');
    clearTimeout(strip._hideTimer);
    strip._hideTimer = setTimeout(() => strip.classList.remove('show'), 9000);
  }

  function alertAlreadySent(key){
    try{
      const sent = JSON.parse(localStorage.getItem('goldpilotMobileAlertSent') || '{}');
      if(sent[key]) return true;
      sent[key] = Date.now();
      const keep = Object.fromEntries(Object.entries(sent).slice(-80));
      localStorage.setItem('goldpilotMobileAlertSent', JSON.stringify(keep));
      return false;
    } catch(e){
      return false;
    }
  }

  function pushMobileAlert(title, body, key){
    if(key && alertAlreadySent(key)) return;
    console.info('GoldPilot mobile alert:', title, body);
    showMobileAlertStrip(title, body);
    if(navigator.vibrate) navigator.vibrate([180, 80, 180]);
    if(mobileAlertsEnabled() && 'Notification' in window && Notification.permission === 'granted'){
      new Notification(title, {body, tag:key || title, renotify:false});
    }
  }

  function colorForDirection(value){
    if(value === 'Bullish' || value === 'up') return 'var(--green)';
    if(value === 'Bearish' || value === 'down') return 'var(--red)';
    return 'var(--amber)';
  }

  function displayNameForSymbol(symbol){
    if(symbol === 'PAXGUSDT') return 'PAXGUSDT gold proxy';
    if(symbol === 'BTCUSDT') return 'BTCUSDT bitcoin';
    if(symbol === 'ETHUSDT') return 'ETHUSDT ethereum';
    if(symbol === 'SOLUSDT') return 'SOLUSDT solana';
    return symbol;
  }

  function loadSettings(){
    const defaults = Object.assign({}, CONFIG.account);
    try{
      const saved = JSON.parse(localStorage.getItem('goldpilotRiskSettings') || '{}');
      if(Number(saved.tickValuePerLot) === 100 && !saved.sizingMode){
        saved.tickValuePerLot = CONFIG.account.tickValuePerLot;
      }
      return sanitizeSettings(Object.assign(defaults, saved));
    } catch(e){
      return defaults;
    }
  }

  function sanitizeSettings(raw){
    return {
      balance: Math.max(0, Number(raw.balance) || CONFIG.account.balance),
      riskPct: clampNumber(Number(raw.riskPct) || CONFIG.account.riskPct, 0.1, 10),
      minLot: Math.max(0.01, Number(raw.minLot) || CONFIG.account.minLot),
      tickValuePerLot: Math.max(1, Number(raw.tickValuePerLot) || CONFIG.account.tickValuePerLot),
      maxDailyLossPct: clampNumber(Number(raw.maxDailyLossPct) || CONFIG.account.maxDailyLossPct, 0.5, 20),
      maxTradesPerDay: Math.max(1, Math.round(Number(raw.maxTradesPerDay) || CONFIG.account.maxTradesPerDay))
    };
  }

  function accountForSymbol(symbol=CONFIG.symbol, overrides={}){
    return Object.assign({}, settings, overrides, {
      symbol,
      sizingMode:'BINANCE_SPOT_QUANTITY',
      tickValuePerLot:1
    });
  }

  function clampNumber(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function saveSettings(nextSettings){
    settings = sanitizeSettings(nextSettings);
    localStorage.setItem('goldpilotRiskSettings', JSON.stringify(settings));
    syncSettingsForm();
  }

  function readSettingsForm(){
    return sanitizeSettings({
      balance: qs('#setting-balance')?.value,
      riskPct: qs('#setting-risk-pct')?.value,
      minLot: qs('#setting-min-lot')?.value,
      tickValuePerLot: qs('#setting-tick-value')?.value,
      maxDailyLossPct: qs('#setting-daily-loss')?.value,
      maxTradesPerDay: qs('#setting-max-trades')?.value
    });
  }

  function syncSettingsForm(){
    const pairs = [
      ['#setting-balance', settings.balance],
      ['#setting-risk-pct', settings.riskPct],
      ['#setting-min-lot', settings.minLot],
      ['#setting-tick-value', settings.tickValuePerLot],
      ['#setting-daily-loss', settings.maxDailyLossPct],
      ['#setting-max-trades', settings.maxTradesPerDay]
    ];
    pairs.forEach(([selector, value]) => {
      const el = qs(selector);
      if(el) el.value = value;
    });
  }

  function getJournalStats(){
    try{
      const key = new Date().toISOString().slice(0, 10);
      const journal = loadTradeJournal();
      const today = journal.filter(row => String(row.date || row.timestamp || '').slice(0, 10) === key);
      const dailyLoss = today.reduce((sum, row) => sum + Math.max(0, Number(row.lossPct || 0)), 0);
      return {tradesToday: today.length, dailyLossPct: dailyLoss};
    } catch(e){
      return {tradesToday: 0, dailyLossPct: 0};
    }
  }

  function loadJournal(){
    try{
      const rows = JSON.parse(localStorage.getItem('goldpilotSignalJournal') || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch(e){
      return [];
    }
  }

  function saveJournal(rows){
    localStorage.setItem('goldpilotSignalJournal', JSON.stringify(rows.slice(0, 250)));
  }

  function loadTradeJournal(){
    try{
      const rows = JSON.parse(localStorage.getItem('goldpilotTradeJournal') || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch(e){
      return [];
    }
  }

  function saveTradeJournal(rows){
    localStorage.setItem('goldpilotTradeJournal', JSON.stringify(rows.slice(0, 250)));
  }

  function loadCommittedSignals(){
    try{
      const saved = JSON.parse(localStorage.getItem('goldpilotCommittedSignals') || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch(e){
      return {};
    }
  }

  function saveCommittedSignals(signals){
    localStorage.setItem('goldpilotCommittedSignals', JSON.stringify(signals || {}));
  }

  function loadDemoTrades(){
    try{
      const rows = JSON.parse(localStorage.getItem('goldpilotDemoTrades') || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch(e){
      return [];
    }
  }

  function saveDemoTrades(rows){
    localStorage.setItem('goldpilotDemoTrades', JSON.stringify(rows.slice(0, 25)));
  }

  function committedKey(symbol=CONFIG.symbol, timeframe=activeTimeframe){
    return `${String(symbol).toUpperCase()}|${String(timeframe).toUpperCase()}`;
  }

  function planSignature(plan){
    if(!plan) return '';
    return [plan.side, plan.entry, plan.stopLoss, plan.takeProfit && plan.takeProfit.tp1, plan.takeProfit && plan.takeProfit.tp2].join('|');
  }

  function currentMarketPrice(){
    const candles = candlesByTimeframe[activeTimeframe] || candlesByTimeframe['15M'] || [];
    const latestCandle = candles[candles.length - 1];
    return latestTicker && latestTicker.last ? latestTicker.last : latestCandle ? latestCandle.c : null;
  }

  function signalExitState(signal, price){
    if(!signal || !signal.plan || price == null) return null;
    const plan = signal.plan;
    if(plan.side === 'LONG'){
      if(signal.progress === 'TP1_HIT' && plan.takeProfit && plan.takeProfit.tp2 != null && price >= plan.takeProfit.tp2) return 'TP2_HIT';
      if(signal.progress === 'TP1_HIT' && price <= plan.entry) return 'BREAKEVEN_STOP';
      if(price <= plan.stopLoss) return 'INVALIDATED';
      if(plan.takeProfit && plan.takeProfit.tp2 != null && price >= plan.takeProfit.tp2) return 'TP2_HIT';
      if(plan.takeProfit && plan.takeProfit.tp1 != null && price >= plan.takeProfit.tp1) return 'TP1_HIT';
    }
    if(plan.side === 'SHORT'){
      if(signal.progress === 'TP1_HIT' && plan.takeProfit && plan.takeProfit.tp2 != null && price <= plan.takeProfit.tp2) return 'TP2_HIT';
      if(signal.progress === 'TP1_HIT' && price >= plan.entry) return 'BREAKEVEN_STOP';
      if(price >= plan.stopLoss) return 'INVALIDATED';
      if(plan.takeProfit && plan.takeProfit.tp2 != null && price <= plan.takeProfit.tp2) return 'TP2_HIT';
      if(plan.takeProfit && plan.takeProfit.tp1 != null && price <= plan.takeProfit.tp1) return 'TP1_HIT';
    }
    return null;
  }

  function demoTradePnl(trade, price){
    if(!trade || price == null) return 0;
    const direction = trade.side === 'LONG' ? 1 : -1;
    return (price - trade.entry) * direction * Number(trade.quantity || 0);
  }

  function upsertDemoTradeFromSignal(signal){
    if(!signal || !signal.plan) return null;
    const rows = loadDemoTrades();
    const existing = rows.find(row => row.signalId === signal.id);
    if(existing) return existing;
    const risk = signal.risk || {};
    const plan = signal.plan;
    const quantity = Math.max(Number(risk.lotSize || 0), Number(risk.minLot || settings.minLot || 0.01));
    const row = {
      id:`demo-${signal.id}`,
      signalId:signal.id,
      symbol:signal.symbol,
      timeframe:signal.timeframe,
      side:plan.side,
      status:'OPEN',
      openedAt:new Date().toISOString(),
      setup:signal.setup && signal.setup.setup ? signal.setup.setup : null,
      entry:plan.entry,
      stopLoss:plan.stopLoss,
      hardStopLoss:plan.stopLoss,
      tp1:plan.takeProfit ? plan.takeProfit.tp1 : null,
      tp2:plan.takeProfit ? plan.takeProfit.tp2 : null,
      quantity,
      riskPct:risk.riskPct || settings.riskPct,
      pnl:0,
      maxFavorable:0,
      maxAdverse:0
    };
    rows.unshift(row);
    saveDemoTrades(rows);
    return row;
  }

  function updateDemoTrades(){
    const price = currentMarketPrice();
    if(price == null) return;
    const rows = loadDemoTrades();
    let changed = false;
    rows.forEach(row => {
      if(row.symbol !== CONFIG.symbol || row.status === 'CLOSED') return;
      const previousStatus = row.status;
      const pnl = demoTradePnl(row, price);
      row.pnl = roundLocal(pnl, 4);
      row.maxFavorable = Math.max(Number(row.maxFavorable || 0), row.pnl);
      row.maxAdverse = Math.min(Number(row.maxAdverse || 0), row.pnl);
      if(row.side === 'LONG'){
        if(row.status === 'TP1_HIT' && price <= row.entry){ row.status = 'CLOSED'; row.result = 'BREAKEVEN'; row.closedAt = new Date().toISOString(); row.exitPrice = row.entry; }
        else if(price <= row.stopLoss){ row.status = 'CLOSED'; row.result = 'SL'; row.closedAt = new Date().toISOString(); row.exitPrice = row.stopLoss; }
        else if(row.tp2 && price >= row.tp2){ row.status = 'CLOSED'; row.result = 'TP2'; row.closedAt = new Date().toISOString(); row.exitPrice = row.tp2; }
        else if(row.tp1 && price >= row.tp1){ row.status = 'TP1_HIT'; row.breakEvenArmed = true; row.stopLoss = row.entry; }
      } else {
        if(row.status === 'TP1_HIT' && price >= row.entry){ row.status = 'CLOSED'; row.result = 'BREAKEVEN'; row.closedAt = new Date().toISOString(); row.exitPrice = row.entry; }
        else if(price >= row.stopLoss){ row.status = 'CLOSED'; row.result = 'SL'; row.closedAt = new Date().toISOString(); row.exitPrice = row.stopLoss; }
        else if(row.tp2 && price <= row.tp2){ row.status = 'CLOSED'; row.result = 'TP2'; row.closedAt = new Date().toISOString(); row.exitPrice = row.tp2; }
        else if(row.tp1 && price <= row.tp1){ row.status = 'TP1_HIT'; row.breakEvenArmed = true; row.stopLoss = row.entry; }
      }
      if(row.status !== previousStatus){
        const resultText = row.status === 'CLOSED' ? `${row.result} hit` : row.status.replace('_', ' ');
        pushMobileAlert(
          `Demo ${row.symbol} ${resultText}`,
          `${row.side} entry ${fmtPrice(row.entry)} | PnL ${row.pnl >= 0 ? '+' : ''}$${fmt(row.pnl, 2)}`,
          `demo|${row.id}|${row.status}|${row.result || ''}`
        );
      }
      changed = true;
    });
    if(changed) saveDemoTrades(rows);
  }

  function roundLocal(value, digits=2){
    if(value == null || !isFinite(Number(value))) return 0;
    const m = Math.pow(10, digits);
    return Math.round(Number(value) * m) / m;
  }

  function commitDecision(decision){
    if(!isCommittableDecision(decision) || !decision.tradePlan) return null;
    const signals = loadCommittedSignals();
    const key = committedKey();
    const existing = signals[key];
    const signature = planSignature(decision.tradePlan);
    const price = currentMarketPrice();
    const exitState = signalExitState(existing, price);
    if(existing && existing.active && exitState === 'TP1_HIT'){
      existing.progress = 'TP1_HIT';
      signals[key] = existing;
      saveCommittedSignals(signals);
      upsertDemoTradeFromSignal(existing);
      return existing;
    }
    if(existing && existing.active && ['INVALIDATED','TP2_HIT','BREAKEVEN_STOP'].includes(exitState)){
      existing.active = false;
      existing.exitState = exitState;
      existing.closedAt = new Date().toISOString();
      signals[key] = existing;
      saveCommittedSignals(signals);
      return null;
    }
    if(existing && existing.active){
      upsertDemoTradeFromSignal(existing);
      return existing;
    }
    if(existing && !existing.active && existing.planSignature === signature){
      return null;
    }
    const committed = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key,
      active:true,
      symbol:CONFIG.symbol,
      timeframe:activeTimeframe,
      timestamp:new Date().toISOString(),
      setup:decision.setup,
      preferredDirection:decision.preferredDirection,
      plan:decision.tradePlan,
      planSignature:signature,
      risk:decision.risk,
      signalGrade:decision.signalGrade,
      entryReadinessScore:decision.entryReadinessScore || 0,
      reason:(decision.reason || []).slice(0, 5)
    };
    signals[key] = committed;
    saveCommittedSignals(signals);
    upsertDemoTradeFromSignal(committed);
    pushMobileAlert(
      `Committed ${committed.symbol} ${committed.plan.side} ${committed.signalGrade ? committed.signalGrade.grade : ''}`,
      `Entry ${fmtPrice(committed.plan.entry)} | SL ${fmtPrice(committed.plan.stopLoss)} | TP1 ${fmtPrice(committed.plan.takeProfit && committed.plan.takeProfit.tp1)}`,
      `commit|${committed.id}`
    );
    return committed;
  }

  function isCommittableDecision(decision){
    return !!(decision && decision.tradePlan && decision.signalGrade && decision.signalGrade.committable);
  }

  function loadActiveCommittedSignal(){
    const signals = loadCommittedSignals();
    const key = committedKey();
    const signal = signals[key];
    if(!signal || !signal.active) return null;
    const exitState = signalExitState(signal, currentMarketPrice());
    if(exitState === 'INVALIDATED' || exitState === 'TP2_HIT' || exitState === 'BREAKEVEN_STOP'){
      signal.active = false;
      signal.exitState = exitState;
      signal.closedAt = new Date().toISOString();
      signals[key] = signal;
      saveCommittedSignals(signals);
      return null;
    }
    if(exitState === 'TP1_HIT'){
      signal.progress = 'TP1_HIT';
      signals[key] = signal;
      saveCommittedSignals(signals);
    }
    upsertDemoTradeFromSignal(signal);
    return signal;
  }

  function applyCommittedSignal(decision, signal){
    if(!signal) return decision;
    const committed = Object.assign({}, decision);
    committed.tradeStatus = signal.progress === 'TP1_HIT' ? 'COMMITTED - TP1 HIT' : 'COMMITTED';
    committed.setupStage = 'COMMITTED';
    committed.entryReadinessScore = Math.max(decision.entryReadinessScore || 0, signal.entryReadinessScore || 0);
    committed.setup = signal.setup || decision.setup;
    committed.preferredDirection = signal.preferredDirection || decision.preferredDirection;
    committed.tradePlan = signal.plan;
    committed.risk = signal.risk || decision.risk;
    committed.entryTrigger = Object.assign({}, decision.entryTrigger, {ready:true, type:'Committed confirmed signal'});
    committed.reason = [
      `Committed ${signal.plan.side} idea from ${formatShortTime(signal.timestamp)}. Keep plan until invalidation or TP2.`,
      ...(signal.reason || [])
    ];
    committed.nextConditionNeeded = signal.progress === 'TP1_HIT'
      ? ['TP1 hit: manage trade, consider partial close and breakeven per rules']
      : ['Do not delete because of one opposite candle. Manage against fixed SL/TP.'];
    return committed;
  }

  function decisionSignature(decision){
    const plan = displayTradePlan(decision) || {};
    const setup = displaySetup(decision);
    return [
      activeTimeframe,
      decision.tradeStatus,
      decision.bias && decision.bias.bias,
      decision.regime && decision.regime.regime,
      setup && setup.setup,
      plan.entry,
      plan.stopLoss,
      plan.takeProfit && plan.takeProfit.tp1
    ].join('|');
  }

  function bestSetupCandidate(decision){
    const preferred = decision.preferredDirection === 'LONG'
      ? decision.longSetup
      : decision.preferredDirection === 'SHORT'
        ? decision.shortSetup
        : null;
    if(preferred && preferred.setup) return preferred;
    return [decision.longSetup, decision.shortSetup]
      .filter(c => c && c.setup)
      .sort((a,b) => {
        const aValid = a.tradePlan && a.tradePlan.riskReward >= 2 ? 1 : 0;
        const bValid = b.tradePlan && b.tradePlan.riskReward >= 2 ? 1 : 0;
        if(aValid !== bValid) return bValid - aValid;
        return (b.entryReadinessScore || 0) - (a.entryReadinessScore || 0);
      })[0] || null;
  }

  function displayReadinessScore(decision){
    const candidate = bestSetupCandidate(decision);
    return Math.max(
      decision.entryReadinessScore || 0,
      candidate ? candidate.entryReadinessScore || 0 : 0,
      decision.longSetup ? decision.longSetup.entryReadinessScore || 0 : 0,
      decision.shortSetup ? decision.shortSetup.entryReadinessScore || 0 : 0
    );
  }

  function displayTradePlan(decision){
    const candidate = bestSetupCandidate(decision);
    return decision.tradePlan || (candidate && candidate.tradePlan) || null;
  }

  function displaySetup(decision){
    const candidate = bestSetupCandidate(decision);
    if(decision.setup && decision.setup.setup) return decision.setup;
    return candidate ? {
      setup:candidate.setup,
      direction:candidate.direction,
      quality:candidate.quality,
      counterBias:candidate.counterBias,
      locationOk:candidate.locationOk,
      volumeOk:candidate.volumeOk,
      trendOk:candidate.trendOk,
      cryptoOk:candidate.cryptoOk,
      retestOk:candidate.retestOk,
      retestContext:candidate.retestContext,
      htfOk:candidate.htfOk,
      sessionOk:candidate.sessionOk,
      reasons:candidate.reasons || [],
      needsConfirmation:candidate.needsConfirmation || candidate.missingConditions || []
    } : decision.setup;
  }

  function createJournalRow(decision, source){
    const plan = displayTradePlan(decision) || {};
    const setup = displaySetup(decision);
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      source: source || 'auto',
      symbol: CONFIG.symbol,
      timeframe: activeTimeframe,
      tradeStatus: decision.tradeStatus,
      bias: decision.bias ? decision.bias.bias : null,
      biasConfidence: decision.bias ? decision.bias.confidence : null,
      regime: decision.regime ? decision.regime.regime : null,
      setup: setup ? setup.setup : null,
      setupQuality: setup ? setup.quality : null,
      preferredDirection: decision.preferredDirection || 'NONE',
      entry: plan.entry || null,
      entryZone: plan.entryZone || null,
      stopLoss: plan.stopLoss || null,
      tp1: plan.takeProfit ? plan.takeProfit.tp1 : null,
      tp2: plan.takeProfit ? plan.takeProfit.tp2 : null,
      riskReward: plan.riskReward || null,
      lotSize: decision.risk ? decision.risk.lotSize : null,
      riskPct: decision.risk ? decision.risk.riskPct : settings.riskPct,
      maxLoss: decision.risk ? decision.risk.maxLoss : null,
      reason: (decision.reason || []).slice(0, 5),
      nextConditionNeeded: (decision.nextConditionNeeded || []).slice(0, 5),
      lossPct: 0
    };
  }

  function appendJournalSnapshot(decision, source){
    const signature = decisionSignature(decision);
    if(source !== 'manual' && signature === lastJournalSignature) return false;
    const rows = loadJournal();
    const newest = createJournalRow(decision, source);
    rows.unshift(newest);
    saveJournal(rows);
    lastJournalSignature = signature;
    renderJournal();
    return true;
  }

  async function fetchJson(url){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try{
      const res = await fetch(url, {signal: controller.signal});
      if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchKlines(interval, limit=CONFIG.candlesLimit, symbol=CONFIG.symbol){
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const rows = await fetchJson(url);
    const now = Date.now();
    return rows.map(row => ({
      t: row[0],
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[5]),
      x: Number(row[6]),
      isClosed: Number(row[6]) <= now
    }));
  }

  function confirmedCandles(candles){
    return (candles || []).filter(c => c && c.isClosed !== false);
  }

  async function fetchTicker(){
    const [ticker, book] = await Promise.all([
      fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${CONFIG.symbol}`),
      fetchJson(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${CONFIG.symbol}`)
    ]);
    return {
      last: Number(ticker.lastPrice),
      changePct: Number(ticker.priceChangePercent),
      volume: Number(ticker.volume),
      bid: Number(book.bidPrice),
      ask: Number(book.askPrice),
      spread: Number(book.askPrice) - Number(book.bidPrice)
    };
  }

  function loadManualNewsEvents(){
    try{
      const raw = localStorage.getItem('goldpilotNewsEvents');
      return raw ? JSON.parse(raw) : [];
    } catch(e){
      return [];
    }
  }

  function classifyNewsImpact(title){
    const text = String(title || '').toLowerCase();
    if(/cpi|inflation|fomc|fed|powell|rate decision|interest rate|nonfarm|nfp|pce|jobs report|unemployment|treasury yield|war|sanction|sec|etf approval|hack|exploit|delist|trading halt/.test(text)) return 'high';
    if(/bitcoin|ethereum|gold|dollar|yield|binance|listing|futures|etf|stablecoin|regulation|tariff/.test(text)) return 'medium';
    return 'low';
  }

  function isEnglishNews(article){
    const language = String(article.language || article.lang || '').toLowerCase();
    return !language || language === 'english' || language === 'en';
  }

  function isTradingNewsTitle(title){
    const text = String(title || '').toLowerCase();
    const marketTerms = /(xauusd|spot gold|gold price|gold prices|gold futures|bullion|bitcoin|btc|ethereum|eth|crypto|binance|futures|etf|federal reserve|fed |fomc|powell|inflation|cpi|pce|nfp|nonfarm|jobs report|treasury yield|yields|us dollar|dxy|interest rate|rate cut|rate hike|sec|stablecoin|tariff|oil price|risk assets)/;
    const irrelevant = /(golden|gold medal|gold mine rescue|goldsch|cave|photo|celebrity|football|soccer|recipe|tourism|wedding|portaltry|liras fiyat|thompsonova|resgatam|laos)/;
    return marketTerms.test(text) && !irrelevant.test(text);
  }

  function normalizeNewsTime(value){
    if(!value) return new Date().toISOString();
    if(typeof value === 'number') return new Date(value).toISOString();
    const raw = String(value);
    const gdelt = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if(gdelt){
      return `${gdelt[1]}-${gdelt[2]}-${gdelt[3]}T${gdelt[4]}:${gdelt[5]}:${gdelt[6]}Z`;
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  function normalizeGdeltNews(data){
    return (data && data.articles || [])
      .filter(article => isEnglishNews(article) && isTradingNewsTitle(article.title))
      .map(article => ({
        title:article.title || 'Market headline',
        time:normalizeNewsTime(article.seendate),
        impact:classifyNewsImpact(article.title),
        source:article.domain || 'GDELT',
        url:article.url || null,
        language:article.language || 'English',
        live:true
      }));
  }

  function normalizeBinanceNews(data){
    const catalogs = data && data.data && data.data.catalogs || [];
    const rows = [];
    catalogs.forEach(catalog => {
      (catalog.articles || []).forEach(article => rows.push({
        title:article.title || catalog.catalogName || 'Binance announcement',
        time:normalizeNewsTime(article.releaseDate),
        impact:classifyNewsImpact(article.title),
        source:catalog.catalogName || 'Binance',
        url:article.code ? `https://www.binance.com/en/support/announcement/${article.code}` : null,
        live:true
      }));
    });
    return rows;
  }

  function dedupeNews(events){
    const seen = new Set();
    return events.filter(ev => {
      const key = `${String(ev.title || '').toLowerCase()}|${String(ev.source || '').toLowerCase()}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function refreshLiveNews(force=false){
    const now = Date.now();
    if(!force && liveNewsEvents.length && now - liveNewsFetchedAt < 10 * 60000) return liveNewsEvents;
    const query = encodeURIComponent('("gold price" OR "spot gold" OR "gold futures" OR xauusd OR bitcoin OR ethereum OR crypto OR binance OR "federal reserve" OR "us dollar" OR "treasury yields" OR inflation OR cpi OR fomc)');
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&format=json&maxrecords=20&timespan=48h&sort=DateDesc`;
    const binanceUrl = 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=8';
    const results = await Promise.allSettled([fetchJson(gdeltUrl), fetchJson(binanceUrl)]);
    const merged = [];
    if(results[0].status === 'fulfilled') merged.push(...normalizeGdeltNews(results[0].value));
    if(results[1].status === 'fulfilled') merged.push(...normalizeBinanceNews(results[1].value));
    if(merged.length){
      liveNewsEvents = dedupeNews(merged)
        .sort((a,b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, 8);
      liveNewsFetchedAt = now;
      newsSourceStatus = 'Live';
    } else {
      newsSourceStatus = liveNewsEvents.length ? 'Cached' : 'Manual';
    }
    return liveNewsEvents;
  }

  function displayNewsEvents(){
    return [...loadManualNewsEvents().map(ev => Object.assign({source:'Manual calendar'}, ev)), ...liveNewsEvents].slice(0, 8);
  }

  function buildDecision(){
    const timeframes = {};
    for(const [label] of TIMEFRAMES){
      if(candlesByTimeframe[label]) timeframes[label] = confirmedCandles(candlesByTimeframe[label]);
    }
    return window.TradingEngines.analyzeGoldPilot({
      candles: confirmedCandles(candlesByTimeframe[activeTimeframe] || candlesByTimeframe['15M'] || []),
      timeframes,
      account: accountForSymbol(CONFIG.symbol, {
        dailyLossHit: getJournalStats().dailyLossPct >= settings.maxDailyLossPct,
        maxTradesHit: getJournalStats().tradesToday >= settings.maxTradesPerDay
      }),
      market: {spread: latestTicker ? latestTicker.spread : 0},
      newsEvents: loadManualNewsEvents()
    });
  }

  async function refreshMarketData(){
    setConnection('CONNECTING', 'var(--amber)');
    const timeframeLoads = TIMEFRAMES.map(async ([label, interval]) => {
      candlesByTimeframe[label] = await fetchKlines(interval);
    });
    await Promise.all([
      ...timeframeLoads,
      fetchTicker().then(t => { latestTicker = t; }),
      refreshLiveNews().catch(err => {
        console.warn('live news unavailable', err);
        newsSourceStatus = liveNewsEvents.length ? 'Cached' : 'Manual';
      })
    ]);
    const decision = buildDecision();
    renderDashboard(decision);
    setConnection('LIVE', 'var(--green)');
  }

  function setActiveTimeframe(label){
    const next = String(label || activeTimeframe).toUpperCase();
    if(!TIMEFRAMES.some(([tf]) => tf === next)) return;
    activeTimeframe = next;
    qsa('.tf').forEach(tf => {
      tf.classList.toggle('active', tf.textContent.trim().toUpperCase() === next);
    });
  }

  function setPrimarySymbol(symbol, timeframe){
    const next = String(symbol || CONFIG.symbol).toUpperCase().trim();
    if(timeframe) setActiveTimeframe(timeframe);
    if(!next || next === CONFIG.symbol){
      if(Object.keys(candlesByTimeframe).length) renderDashboard(buildDecision());
      return;
    }
    ensurePrimarySymbolOption(next);
    CONFIG.symbol = next;
    CONFIG.displayName = displayNameForSymbol(next);
    const picker = qs('#primary-symbol');
    if(picker) picker.value = next;
    candlesByTimeframe = {};
    latestTicker = null;
    lastJournalSignature = null;
    setConnection('CONNECTING', 'var(--amber)');
    refreshMarketData().catch(err => {
      console.error(err);
      setConnection('DATA ERROR', 'var(--red)');
      setHtml('#status-reason', `<b>Data error.</b> ${escapeHtml(err.message)}. Check ${escapeHtml(next)} availability.`);
    });
  }

  function ensurePrimarySymbolOption(symbol){
    const picker = qs('#primary-symbol');
    if(!picker || Array.from(picker.options).some(opt => opt.value === symbol)) return;
    const option = document.createElement('option');
    option.value = symbol;
    option.textContent = symbol;
    picker.appendChild(option);
  }

  async function scanWatchlist(){
    const symbols = loadWatchlistSymbols();
    const rows = await Promise.all(symbols.map(scanWatchSymbol));
    watchlistRows = rows.filter(Boolean).sort((a,b) => b.score - a.score);
    renderWatchlist();
    notifyConfirmedTrades(watchlistRows);
  }

  function loadWatchlistSymbols(){
    try{
      const saved = JSON.parse(localStorage.getItem('goldpilotWatchlistSymbols') || '[]');
      if(Array.isArray(saved) && saved.length) return saved.map(s => String(s).toUpperCase().trim()).filter(Boolean);
    } catch(e){}
    return WATCHLIST_SYMBOLS;
  }

  async function scanWatchSymbol(symbol){
    try{
      const [m15, h1, h4, d1] = await Promise.all([
        fetchKlines('15m', 180, symbol),
        fetchKlines('1h', 180, symbol),
        fetchKlines('4h', 120, symbol),
        fetchKlines('1d', 90, symbol)
      ]);
      const confirmedM15 = confirmedCandles(m15);
      const confirmedH1 = confirmedCandles(h1);
      const confirmedH4 = confirmedCandles(h4);
      const confirmedD1 = confirmedCandles(d1);
      const decision = window.TradingEngines.analyzeGoldPilot({
        candles:confirmedM15,
        timeframes:{'15M':confirmedM15,'1H':confirmedH1,'4H':confirmedH4,'D':confirmedD1},
        account:accountForSymbol(symbol),
        market:{spread:0},
        newsEvents:loadManualNewsEvents()
      });
      const preferredCandidate = decision.preferredDirection === 'LONG'
        ? decision.longSetup
        : decision.preferredDirection === 'SHORT'
          ? decision.shortSetup
          : null;
      const plan = decision.tradePlan || (preferredCandidate && preferredCandidate.tradePlan) || null;
      const setup = decision.setup && decision.setup.setup
        ? decision.setup.setup
        : preferredCandidate && preferredCandidate.setup
          ? preferredCandidate.setup
          : decision.regime.regime;
      const monitorScore = Math.max(
        decision.entryReadinessScore || 0,
        decision.longSetup ? decision.longSetup.entryReadinessScore || 0 : 0,
        decision.shortSetup ? decision.shortSetup.entryReadinessScore || 0 : 0,
        decision.preferredDirection === 'NONE' && decision.nextStepForecast ? Math.min(45, decision.nextStepForecast.confidence || 0) : 0
      );
      return {
        symbol,
        status:decision.tradeStatus,
        stage:decision.setupStage,
        score:monitorScore,
        bias:decision.bias ? decision.bias.bias : '-',
        setup,
        side:plan ? plan.side : decision.preferredDirection,
        entry:plan ? plan.entry : null,
        stopLoss:plan ? plan.stopLoss : null,
        tp1:plan && plan.takeProfit ? plan.takeProfit.tp1 : null,
        riskReward:plan ? plan.riskReward : null,
        grade:decision.signalGrade ? decision.signalGrade.grade : '-',
        committable:decision.signalGrade ? decision.signalGrade.committable : false,
        plan,
        risk:decision.risk,
        setupObj:decision.setup,
        scannedAt:Date.now(),
        ready:isCommittableDecision(decision),
        blocked:decision.tradeStatus === 'BLOCKED',
        reason:[...(decision.missingConditions || []), ...(decision.nextConditionNeeded || []), ...(decision.reason || [])].slice(0,2).join(' ')
      };
    } catch(err){
      return {symbol, status:'DATA ERROR', stage:'ERROR', score:0, bias:'-', setup:err.message, ready:false, blocked:true};
    }
  }

  function setConnection(text, color){
    const el = qs('#connection-status') || qs('.live-badge');
    if(!el) return;
    const dot = el.querySelector('.live-dot');
    el.lastChild.textContent = ` ${text}`;
    el.style.color = color;
    if(dot){
      dot.style.background = color;
      dot.style.boxShadow = `0 0 6px ${color}`;
    }
  }

  function renderDashboard(decision){
    const freshCommit = commitDecision(decision);
    const activeCommit = freshCommit || loadActiveCommittedSignal();
    updateDemoTrades();
    decision = applyCommittedSignal(decision, activeCommit);
    lastDecision = decision;
    renderHero(decision);
    renderChart(candlesByTimeframe[activeTimeframe] || candlesByTimeframe['15M'] || []);
    renderBias(decision);
    renderRegime(decision);
    renderCandleMetrics(decision);
    renderLiquidity(decision);
    renderSignal(decision);
    renderRisk(decision);
    renderNews(decision);
    renderDemoTrades();
    renderChecklist(decision);
    renderBottomBar(decision);
    renderDecisionState(decision);
    appendJournalSnapshot(decision, 'auto');
    populateTradeSignalSelect();
    renderTradeJournal();
  }

  function renderDecisionState(decision){
    const score = displayReadinessScore(decision);
    const badge = qs('#status-badge');
    if(badge && isCommittableDecision(decision)) badge.classList.add('allowed');
    const setupEl = qsa('.status-row > div')[1];
    if(setupEl){
      const lines = setupEl.querySelectorAll('div');
      if(lines[1]){
        const grade = decision.signalGrade ? ` | grade ${decision.signalGrade.grade}` : '';
        lines[1].textContent = `${decision.setupStage || 'WAIT'} | readiness ${score}%${grade}`;
      }
    }
  }

  function renderHero(decision){
    const badge = qs('#status-badge');
    if(badge){
      badge.className = 'status-badge';
      if(decision.tradeStatus === 'BLOCKED') badge.classList.add('blocked');
      else if(decision.tradeStatus.includes('ALLOWED') || isCommittableDecision(decision) || decision.tradeStatus.includes('COMMITTED')) badge.classList.add('allowed');
      else badge.classList.add('wait');
      badge.textContent = decision.tradeStatus;
    }

    const setup = displaySetup(decision);
    const score = displayReadinessScore(decision);
    const setupText = setup && setup.setup
      ? `${setup.setup} (${setup.quality || 'Watch'}) | readiness ${score}%`
      : 'No valid setup confirmed';
    const setupEl = qsa('.status-row > div')[1];
    if(setupEl){
      const lines = setupEl.querySelectorAll('div');
      if(lines[1]) lines[1].textContent = setupText;
      const regime = setupEl.querySelector('.regime-badge');
      if(regime) regime.innerHTML = `<i class="ti ti-chart-candle" aria-hidden="true" style="font-size:12px"></i> ${decision.regime.regime}`;
    }

    setText('#live-price', fmtPrice(latestTicker ? latestTicker.last : null));
    const chg = qs('#live-chg');
    if(chg && latestTicker){
      chg.textContent = `${latestTicker.changePct >= 0 ? 'UP' : 'DOWN'} ${pct(latestTicker.changePct)} today`;
      chg.style.color = latestTicker.changePct >= 0 ? 'var(--green)' : 'var(--red)';
    }
    const label = qs('.price-display div');
    if(label) label.textContent = CONFIG.displayName;

    const forecast = decision.nextStepForecast;
    const reasons = (decision.reason || []).concat(decision.nextConditionNeeded || []);
    if(forecast && forecast.expectation){
      reasons.push(`Next-step read (${forecast.confidence}%): ${forecast.expectation}. ${forecast.nextCandleMust}`);
    }
    setHtml('#status-reason', reasons.length
      ? `<b>${decision.tradeStatus}.</b> ${reasons.map(escapeHtml).join(' ')}`
      : '<b>WAIT.</b> No engine reason returned yet.');
  }

  function renderChart(candles){
    const svg = qs('svg.chart g#candles');
    if(!svg || !candles.length) return;
    const chartTitle = qs('.chart-header > span');
    if(chartTitle) chartTitle.textContent = `Price Action - ${activeTimeframe}`;
    const recent = candles.slice(-90);
    const minLow = Math.min(...recent.map(c => c.l));
    const maxHigh = Math.max(...recent.map(c => c.h));
    const pad = (maxHigh - minLow) * 0.08 || 1;
    const min = minLow - pad;
    const max = maxHigh + pad;
    const width = 600;
    const height = 300;
    const axisWidth = 72;
    const plotWidth = width - axisWidth;
    const cw = Math.max(3, Math.floor(plotWidth / recent.length) - 1);
    const y = price => 8 + ((max - price) / (max - min)) * (height - 16);
    svg.innerHTML = '';
    const candleSlots = [];
    recent.forEach((c, i) => {
      const x = i * (plotWidth / recent.length) + 1;
      candleSlots.push({x, width:cw, candle:c, index:i});
      const bull = c.c >= c.o;
      const col = bull ? '#3DB87E' : '#E05252';
      const top = Math.min(y(c.o), y(c.c));
      const bottom = Math.max(y(c.o), y(c.c));
      svg.innerHTML += `<line x1="${x + cw / 2}" y1="${y(c.h)}" x2="${x + cw / 2}" y2="${y(c.l)}" stroke="${col}" stroke-width="1"/>`;
      svg.innerHTML += `<rect x="${x}" y="${top}" width="${cw}" height="${Math.max(1, bottom - top)}" fill="${col}" rx="0.5"/>`;
    });

    const texts = qsa('svg.chart text');
    if(texts[0]) texts[0].textContent = `${fmtPrice(minLow)} - sell-side liquidity`;
    if(texts[1]) texts[1].textContent = `${fmtPrice(maxHigh)} - buy-side liquidity`;
    const zones = qsa('svg.chart > rect');
    if(zones[0]) zones[0].setAttribute('y', String(Math.round(y(minLow) - 9)));
    if(zones[1]) zones[1].setAttribute('y', String(Math.max(2, Math.round(y(maxHigh) - 9))));
    if(texts[0]) texts[0].setAttribute('y', String(Math.round(y(minLow) + 4)));
    if(texts[1]) texts[1].setAttribute('y', String(Math.max(13, Math.round(y(maxHigh) + 4))));
    chartScale = {
      min,
      max,
      width,
      height,
      plotWidth,
      axisWidth,
      candles:candleSlots,
      priceFromY: yy => max - ((Math.max(8, Math.min(height - 8, yy)) - 8) / (height - 16)) * (max - min)
    };
    renderPriceAxis(min, max, y, plotWidth, width, height, recent[recent.length - 1].c);
  }

  function svgPointFromEvent(svg, ev){
    const source = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    const rect = svg.getBoundingClientRect();
    const x = ((source.clientX - rect.left) / rect.width) * 600;
    const y = ((source.clientY - rect.top) / rect.height) * 300;
    return {x:Math.max(0, Math.min(600, x)), y:Math.max(0, Math.min(300, y)), clientX:source.clientX, clientY:source.clientY};
  }

  function candleAtX(x){
    if(!chartScale || !chartScale.candles.length) return null;
    const slotWidth = chartScale.plotWidth / chartScale.candles.length;
    const idx = Math.max(0, Math.min(chartScale.candles.length - 1, Math.floor(x / slotWidth)));
    return chartScale.candles[idx] || null;
  }

  function updateChartHover(ev){
    const svgEl = qs('svg.chart');
    const hover = qs('#hover-price-marker');
    const tooltip = qs('#chart-tooltip');
    if(!svgEl || !hover || !tooltip || !chartScale) return;
    const p = svgPointFromEvent(svgEl, ev);
    if(p.x > chartScale.plotWidth){
      clearChartHover();
      return;
    }
    const price = chartScale.priceFromY(p.y);
    const y = Math.round(p.y);
    const x = Math.round(p.x);
    hover.style.display = 'block';
    hover.innerHTML = `<line class="hover-crosshair" x1="0" y1="${y}" x2="${chartScale.plotWidth}" y2="${y}"></line>
      <line class="hover-crosshair" x1="${x}" y1="8" x2="${x}" y2="${chartScale.height - 8}"></line>
      <rect class="hover-price-bg" x="${chartScale.plotWidth + 4}" y="${Math.max(2, Math.min(chartScale.height - 20, y - 9))}" width="${chartScale.width - chartScale.plotWidth - 8}" height="18" rx="4"></rect>
      <text class="hover-price-text" x="${chartScale.plotWidth + 9}" y="${Math.max(15, Math.min(chartScale.height - 7, y + 4))}">${fmtPrice(price)}</text>`;

    const slot = candleAtX(p.x);
    const c = slot && slot.candle;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(svgEl.clientWidth - 196, Math.max(8, p.clientX - svgEl.getBoundingClientRect().left + 12))}px`;
    tooltip.style.top = `${Math.min(svgEl.clientHeight - 96, Math.max(8, p.clientY - svgEl.getBoundingClientRect().top + 12))}px`;
    tooltip.innerHTML = c
      ? `<b>${CONFIG.symbol} ${activeTimeframe}</b><br>Cursor ${fmtPrice(price)}<br>O ${fmtPrice(c.o)} H ${fmtPrice(c.h)} L ${fmtPrice(c.l)} C ${fmtPrice(c.c)}`
      : `<b>${CONFIG.symbol} ${activeTimeframe}</b><br>Cursor ${fmtPrice(price)}`;
  }

  function clearChartHover(){
    const hover = qs('#hover-price-marker');
    const tooltip = qs('#chart-tooltip');
    if(hover) hover.style.display = 'none';
    if(tooltip) tooltip.style.display = 'none';
  }

  function renderPriceAxis(min, max, y, plotWidth, width, height, currentPrice){
    const axis = qs('#price-axis');
    const marker = qs('#current-price-marker');
    if(!axis || !marker) return;
    const ticks = 5;
    const priceRange = max - min || 1;
    const tickValues = Array.from({length:ticks}, (_, i) => max - (priceRange * i / (ticks - 1)));
    axis.innerHTML = tickValues.map(price => {
      const yy = Math.round(y(price));
      return `<line class="price-grid" x1="0" y1="${yy}" x2="${plotWidth}" y2="${yy}"></line>
        <text x="${plotWidth + 8}" y="${yy + 3}">${fmtPrice(price)}</text>`;
    }).join('');

    const livePrice = latestTicker && latestTicker.last ? latestTicker.last : currentPrice;
    const priceY = Math.max(10, Math.min(height - 10, Math.round(y(livePrice))));
    marker.innerHTML = `<line class="current-price-line" x1="0" y1="${priceY}" x2="${plotWidth}" y2="${priceY}"></line>
      <rect class="current-price-bg" x="${plotWidth + 4}" y="${priceY - 9}" width="${width - plotWidth - 8}" height="18" rx="4"></rect>
      <text class="current-price-text" x="${plotWidth + 9}" y="${priceY + 4}">${fmtPrice(livePrice)}</text>`;
  }

  function renderBias(decision){
    const modules = qsa('.module');
    const biasModule = modules[0];
    if(!biasModule) return;
    const title = biasModule.querySelector('.module-title');
    const sub = biasModule.querySelector('.module-sub');
    const fill = biasModule.querySelector('.score-fill');
    if(title){
      title.textContent = decision.bias.bias;
      title.style.color = colorForDirection(decision.bias.bias);
    }
    if(sub) sub.textContent = `${decision.bias.confidence}% confidence | ${decision.bias.allowedDirection}`;
    if(fill){
      fill.style.width = `${decision.bias.confidence}%`;
      fill.style.background = colorForDirection(decision.bias.bias);
    }
    const trendMap = {};
    (decision.bias.details || []).forEach(d => { trendMap[d.timeframe] = d.trend; });
    const dots = biasModule.querySelectorAll('.bias-dot');
    const labels = ['D','4H','1H','15M','5M'];
    dots.forEach((dot, i) => {
      dot.className = 'bias-dot';
      const trend = trendMap[labels[i]];
      dot.classList.add(trend === 'up' ? 'bullish' : trend === 'down' ? 'bearish' : 'neutral');
    });
  }

  function renderRegime(decision){
    const modules = qsa('.module');
    const module = modules[1];
    if(!module) return;
    const title = module.querySelector('.module-title');
    const sub = module.querySelector('.module-sub');
    const tagWrap = module.querySelector('div[style*="flex-wrap"]');
    if(title) title.textContent = decision.regime.regime;
    if(sub) sub.textContent = `ATR ${decision.regime.atrPct}% | Range ${decision.regime.recentRangePct}%`;
    if(sub && decision.trendQuality){
      sub.textContent = `ATR ${decision.regime.atrPct}% | Trend ${decision.trendQuality.quality} ${decision.trendQuality.score}%`;
    }
    if(tagWrap){
      tagWrap.innerHTML = (decision.regime.allowedStrategies || []).map(s =>
        `<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(201,168,76,.1);color:var(--gold);font-family:'DM Mono',monospace">${escapeHtml(s)}</span>`
      ).join('');
    }
  }

  function renderCandleMetrics(decision){
    const module = qsa('.module')[2];
    if(!module) return;
    const scores = module.querySelectorAll('span[style*="DM Mono"]');
    const fills = module.querySelectorAll('.score-fill');
    const strength = decision.candleBehavior.strengthScore || 0;
    const rejection = decision.candleBehavior.rejectionScore || 0;
    const quality = decision.candleBehavior.breakoutQuality || '-';
    if(scores[0]) scores[0].textContent = `${strength}/100`;
    if(scores[1]) scores[1].textContent = `${rejection}/100`;
    if(scores[2]) scores[2].textContent = quality;
    if(fills[0]) fills[0].style.width = `${strength}%`;
    if(fills[1]) fills[1].style.width = `${rejection}%`;
    if(fills[2]) fills[2].style.width = `${quality === 'strong' ? 82 : quality === 'medium' ? 55 : 28}%`;
  }

  function renderLiquidity(decision){
    const module = qsa('.module')[3];
    if(!module) return;
    const levels = decision.liquidityMap.nearest || [];
    const html = levels.map(level => {
      const isBuy = level.type === 'buy-side';
      const color = isBuy ? 'var(--amber)' : 'var(--red)';
      return `<div class="liq-item">
        <div class="liq-dot" style="background:${color}"></div>
        <div class="liq-label">${escapeHtml(level.name)} (${escapeHtml(level.type)})</div>
        <div class="liq-price" style="color:${color}">${fmtPrice(level.price)}</div>
        <div class="liq-tag pending">${fmtPrice(level.distance)}</div>
      </div>`;
    }).join('') || '<div class="module-sub">No liquidity levels detected yet.</div>';
    const existing = module.querySelector('.liq-item');
    if(existing){
      while(module.children.length > 1) module.removeChild(module.lastChild);
      module.insertAdjacentHTML('beforeend', html);
    }
  }

  function renderSignal(decision){
    const card = qs('.signal-card');
    if(!card) return;
    const plan = displayTradePlan(decision);
    const setup = displaySetup(decision);
    const type = card.querySelector('.signal-type');
    const icon = card.querySelector('.signal-header i');
    const time = card.querySelector('.signal-time');
    const clear = qs('#clear-committed-signal');
    const hint = card.querySelector('.signal-header + div');
    const values = card.querySelectorAll('.val');
    const zone = card.querySelector('.zone-price');
    const rr = card.querySelector('.rr-val');
    const rrFill = card.querySelector('.rr-fill');
    const side = plan ? plan.side : 'WAIT';
    const planHasValidReward = !!(plan && plan.riskReward >= 2);
    renderDirectionalSetups(decision);
    if(type){
      const prefix = decision.tradeStatus.includes('COMMITTED') ? 'COMMITTED ' : '';
      type.textContent = plan && setup && setup.setup
        ? `${prefix}${side} - ${setup.setup}`
        : `${decision.preferredDirection || 'NONE'} - ${setup && setup.setup ? setup.setup : 'No valid signal'}`;
      type.style.color = side === 'SHORT' ? 'var(--red)' : side === 'LONG' ? 'var(--green)' : 'var(--amber)';
    }
    if(icon){
      icon.className = side === 'SHORT' ? 'ti ti-arrow-down' : 'ti ti-arrow-up';
      icon.style.color = side === 'SHORT' ? 'var(--red)' : 'var(--green)';
    }
    if(time) time.textContent = decision.tradeStatus.includes('COMMITTED') ? 'Committed' : isCommittableDecision(decision) ? `Ready ${decision.signalGrade.grade}` : 'Forming';
    if(clear) clear.style.display = decision.tradeStatus.includes('COMMITTED') ? 'inline-flex' : 'none';
    if(hint){
      const forecast = decision.nextStepForecast;
      const targetNote = plan && plan.targetQuality ? ` Target quality: ${plan.targetQuality}. ${plan.targetWarning || ''}` : '';
      hint.textContent = forecast
        ? `${forecast.expectation}. ${forecast.nextCandleMust}`
        : (decision.nextConditionNeeded || decision.reason || ['Wait for confirmed setup.']).join(' ');
      hint.textContent += targetNote;
    }
    if(zone) zone.textContent = plan && plan.entryZone
      ? (planHasValidReward ? `${fmtPrice(plan.entryZone[0])} - ${fmtPrice(plan.entryZone[1])}` : 'NO ENTRY - TARGET TOO CLOSE')
      : '-';
    if(values[0]) values[0].textContent = plan ? (planHasValidReward ? fmtPrice(plan.takeProfit.tp1) : `Wait (${fmtPrice(plan.takeProfit.tp1)})`) : '-';
    if(values[1]) values[1].textContent = plan ? fmtPrice(plan.invalidation) : '-';
    if(values[2]) values[2].textContent = plan ? (planHasValidReward ? fmtPrice(plan.takeProfit.tp2) : `Wait (${fmtPrice(plan.takeProfit.tp2)})`) : '-';
    if(values[3]) values[3].textContent = plan ? fmtPrice(plan.stopLoss) : '-';
    if(rr) rr.textContent = plan ? `1:${fmt(plan.riskReward, 2)}` : '-';
    if(rrFill) rrFill.style.width = plan ? `${Math.min(100, plan.riskReward * 25)}%` : '0%';
  }

  function renderDirectionalSetups(decision){
    const grid = qs('#direction-grid');
    if(!grid) return;
    const long = decision.longSetup || {};
    const short = decision.shortSetup || {};
    grid.innerHTML = [long, short].map(side => {
      const dir = side.direction || 'NONE';
      const cls = dir === 'SHORT' ? 'short' : 'long';
      const setup = side.setup || 'No setup';
      const stage = side.setupStage || 'NO_SETUP';
      const score = side.entryReadinessScore || 0;
      const missing = (side.missingConditions || side.needsConfirmation || []).slice(0, 2).join(' | ');
      const preferred = decision.preferredDirection === dir ? ' *' : '';
      const biasTag = side.counterBias ? 'Counter-bias | ' : '';
      return `<div class="direction-card ${cls}">
        <div class="direction-head">
          <span class="direction-name">${escapeHtml(dir)}${preferred}</span>
          <span class="direction-score">${score}%</span>
        </div>
        <div class="direction-stage"><b>${escapeHtml(stage)}</b><br>${escapeHtml(biasTag + setup)}${missing ? `<br>${escapeHtml(missing)}` : ''}</div>
      </div>`;
    }).join('');
  }

  function renderRisk(decision){
    const rows = qsa('.risk-row .risk-val');
    const risk = decision.risk || {};
    const stats = getJournalStats();
    if(rows[0]) rows[0].textContent = risk.balance ? `$${fmt(risk.balance, 2)}` : `$${fmt(settings.balance, 2)}`;
    if(rows[1]) rows[1].textContent = `${risk.riskPct || settings.riskPct}% - $${fmt(risk.maxLoss || settings.balance * settings.riskPct / 100, 2)}`;
    if(rows[2]) rows[2].textContent = risk.slDistance ? `${fmtPrice(risk.slDistance)} price units` : '-';
    if(rows[3]) rows[3].textContent = risk.lotSize == null ? '-' : `${fmt(risk.lotSize, 2)} qty`;
    if(rows[4]) rows[4].textContent = `${fmt(stats.dailyLossPct, 2)} / ${fmt(settings.maxDailyLossPct, 1)}%`;
    if(rows[5]) rows[5].textContent = `${stats.tradesToday} / ${settings.maxTradesPerDay}`;
    const status = qs('#risk-panel')?.querySelector('div[style*="font-size:12px"]');
    if(status){
      status.textContent = risk.allowed ? 'Permitted by Binance spot quantity risk engine' : (risk.reasons || ['No actionable trade plan'])[0];
      status.style.color = risk.allowed ? 'var(--green)' : 'var(--amber)';
    }
  }

  function renderNews(decision){
    const panel = qs('#news-panel');
    if(!panel) return;
    const events = displayNewsEvents();
    const items = panel.querySelectorAll('.news-item');
    items.forEach(item => item.remove());
    const insertBefore = panel.querySelector('div[style*="margin-top:10px"]');
    const html = events.length ? events.map(ev => `<div class="news-item">
      <div class="news-dot ${String(ev.impact).toLowerCase() === 'high' ? 'high-impact' : 'med-impact'}"></div>
      <div>
        <div class="news-text">${ev.url ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.title || 'Market headline')}</a>` : escapeHtml(ev.title || 'Economic event')}</div>
        <div class="news-time">${escapeHtml(formatEventTime(ev.time || ev.date || ev.timestamp))}</div>
        <span class="news-tag ${String(ev.impact).toLowerCase() === 'high' ? 'high-tag' : 'med-tag'}">${escapeHtml(ev.impact || 'Live')}</span>
        <span class="news-tag med-tag">${escapeHtml(ev.source || (ev.live ? 'Live' : 'Manual'))}</span>
      </div>
    </div>`).join('') : `<div class="news-item">
      <div class="news-dot med-impact"></div>
      <div>
        <div class="news-text">Live news feed has not loaded yet</div>
        <div class="news-time">Manual calendar backup: localStorage key goldpilotNewsEvents</div>
        <span class="news-tag med-tag">Manual</span>
      </div>
    </div>`;
    if(insertBefore) insertBefore.insertAdjacentHTML('beforebegin', html);
    if(insertBefore){
      const blocked = decision.tradeStatus === 'BLOCKED' && (decision.reason || []).some(r => /news/i.test(r));
      insertBefore.innerHTML = `<div style="font-size:11px;color:${blocked ? 'var(--red)' : 'var(--green)'};font-weight:500">${blocked ? 'News block active' : `${escapeHtml(newsSourceStatus)} news feed active`}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${blocked ? escapeHtml(decision.reason.join(' ')) : 'Live headlines update automatically. Manual calendar events still control high-impact scheduled trade blocks.'}</div>`;
    }
  }

  function renderChecklist(decision){
    const missing = decision.missingConditions || [];
    const setup = displaySetup(decision);
    const plan = displayTradePlan(decision);
    const location = decision.locationContext && decision.locationContext.range ? decision.locationContext.range : null;
    const preferred = decision.preferredDirection;
    const locationOk = preferred === 'LONG'
      ? decision.locationContext && decision.locationContext.longAllowedLocation
      : preferred === 'SHORT'
        ? decision.locationContext && decision.locationContext.shortAllowedLocation
        : location && location.zone === 'Equilibrium';
    const volume = decision.volumeContext || null;
    const trend = decision.trendQuality || null;
    const crypto = decision.cryptoContext || null;
    const candidate = bestSetupCandidate(decision) || {};
    const retest = candidate.retestContext || (setup && setup.retestContext) || null;
    const htf = decision.htfAlignment || null;
    const sessionRules = decision.sessionRules || null;
    const checks = [
      {ok: decision.tradability.status !== 'BLOCKED', label: `Tradability: ${decision.tradability.status}`},
      {ok: decision.bias.bias !== 'Neutral', label: `Higher-TF bias: ${decision.bias.bias}`},
      {ok: decision.tradability.spread === 0 || decision.tradability.status !== 'BLOCKED', label: `Spread: ${fmt(decision.tradability.spread, 2)}`},
      {ok: !(decision.reason || []).some(r => /news/i.test(r)), label: 'No active news block'},
      {ok: !sessionRules || candidate.sessionOk !== false, label: sessionRules ? `Session rules: ${sessionRules.session}` : 'Session rules'},
      {ok: !!locationOk, label: location ? `Location: ${location.zone} (${fmt(location.positionPct, 1)}%)` : 'Location: premium/discount unavailable'},
      {ok: !retest || candidate.retestOk !== false, label: retest ? `Retest: ${retest.quality}${retest.level ? ` @ ${fmtPrice(retest.level)}` : ''}` : 'Retest quality'},
      {ok: !htf || candidate.htfOk !== false, label: htf ? `HTF zones: ${htf.summary}` : 'HTF zone alignment'},
      {ok: !volume || volume.score >= 50, label: volume ? `Volume: ${volume.state} (${volume.ratio}x)` : 'Volume confirmation'},
      {ok: !trend || trend.score >= 45, label: trend ? `Trend quality: ${trend.quality} ${trend.score}%` : 'Trend quality'},
      {ok: !crypto || !crypto.chaseRisk, label: crypto && crypto.isCrypto ? 'Crypto chase/liquidation risk' : 'Crypto risk clear'},
      {ok: !!(setup && setup.direction), label: setup && setup.setup ? setup.setup : 'Valid setup detected'},
      {ok: decision.preferredDirection !== 'NONE', label: `Preferred direction: ${decision.preferredDirection || 'NONE'}`},
      {ok: !!decision.nextStepForecast, label: decision.nextStepForecast ? `Next step: ${decision.nextStepForecast.leadDirection} ${decision.nextStepForecast.confidence}%` : 'Next-step read'},
      {ok: !missing.some(m => /BOS|CHOCH/i.test(m)), label: 'BOS/CHOCH confirmation'},
      {ok: decision.entryTrigger.ready, label: `Entry trigger ready (${displayReadinessScore(decision)}%)`},
      {ok: !!plan && plan.riskReward >= 2, label: 'R:R minimum 1:2'},
      {ok: decision.risk.allowed, label: 'Risk permission'}
    ];
    const cl = qs('#checklist');
    if(!cl) return;
    cl.innerHTML = checks.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      <div style="width:16px;height:16px;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;
        background:${c.ok ? 'rgba(61,184,126,.12)' : 'rgba(255,255,255,.04)'};
        border:1px solid ${c.ok ? 'rgba(61,184,126,.25)' : 'var(--border)'};
        color:${c.ok ? 'var(--green)' : 'var(--text3)'}">${c.ok ? 'OK' : '-'}</div>
      <span style="font-size:12px;color:${c.ok ? 'var(--text)' : 'var(--text3)'}">${escapeHtml(c.label)}</span>
      ${c.ok ? '' : '<span style="font-size:10px;color:var(--amber);margin-left:auto;font-family:\'DM Mono\',monospace">Wait</span>'}
    </div>`).join('');
    if(cl.lastChild) cl.lastChild.style.borderBottom = 'none';
  }

  function renderWatchlist(){
    const wrap = qs('#crypto-watchlist');
    if(!wrap) return;
    const rows = watchlistRows.slice(0, 12);
    if(!rows.length){
      wrap.innerHTML = '<div class="watchlist-row"><div class="watch-symbol">-</div><div class="watch-status">No scan results yet</div><div class="watch-score wait">-</div></div>';
      return;
    }
    wrap.innerHTML = rows.map(row => {
      const scoreClass = row.ready ? 'ready' : row.blocked ? 'blocked' : 'wait';
      const detail = row.entry
        ? `${row.grade || '-'} ${row.side || ''} entry ${fmtPrice(row.entry)} | SL ${fmtPrice(row.stopLoss)} | TP1 ${fmtPrice(row.tp1)} | R:R ${row.riskReward ? `1:${fmt(row.riskReward,2)}` : '-'}`
        : `${row.bias} | ${row.setup || row.reason || row.stage}`;
      const age = row.scannedAt ? `scan ${formatAge(row.scannedAt)} ago` : 'scan age -';
      return `<div class="watchlist-row" data-symbol="${escapeHtml(row.symbol)}" title="Open ${escapeHtml(row.symbol)} chart">
        <div class="watch-symbol">${escapeHtml(row.symbol.replace('USDT',''))}</div>
        <div class="watch-status">${escapeHtml(row.status)}<br>${escapeHtml(detail)}<br><span style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace">${escapeHtml(age)}</span></div>
        <div class="watch-score ${scoreClass}">${row.score}%</div>
      </div>`;
    }).join('');
    const alerts = rows.filter(r => r.ready);
    const alertBox = qs('#watchlist-alerts');
    if(alertBox){
      alertBox.innerHTML = alerts.length
        ? `<b>${alerts.length} confirmed setup${alerts.length > 1 ? 's' : ''}:</b>${alerts.map(a =>
            `<button type="button" data-symbol="${escapeHtml(a.symbol)}">${escapeHtml(a.symbol)} ${escapeHtml(a.grade || '')} ${escapeHtml(a.side || '')} entry ${fmtPrice(a.entry)} | SL ${fmtPrice(a.stopLoss)} | TP1 ${fmtPrice(a.tp1)}</button>`
          ).join('')}<div style="margin-top:6px">${escapeHtml(watchlistCommitSummary(rows))}</div>`
        : `Scanning ${loadWatchlistSymbols().length} configured Binance symbols. No confirmed trade right now.<div style="margin-top:6px">${escapeHtml(watchlistCommitSummary(rows))}</div>`;
    }
  }

  function dateKey(value){
    const d = value ? new Date(value) : new Date();
    if(isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function watchlistCommitSummary(rows){
    const today = dateKey();
    const demoCommittedToday = loadDemoTrades().filter(row => dateKey(row.openedAt || row.createdAt) === today).length;
    const activeCommitted = Object.values(loadCommittedSignals()).filter(signal => signal && signal.active).length;
    const best = rows
      .filter(row => row && !row.ready)
      .sort((a,b) => (b.score || 0) - (a.score || 0))[0] || null;
    if(!best){
      return `Committed today: ${demoCommittedToday} | Active committed: ${activeCommitted} | No watchlist scan result yet.`;
    }
    const side = best.side && best.side !== 'NONE' ? ` ${best.side}` : '';
    const blocker = best.reason || best.setup || best.stage || 'Waiting for cleaner setup';
    return `Committed today: ${demoCommittedToday} | Active committed: ${activeCommitted} | Best forming: ${best.symbol}${side} ${best.score}% | ${blocker}`;
  }

  function notifyConfirmedTrades(rows){
    const readyRows = rows.filter(r => r.ready);
    if(!readyRows.length) return;
    let sent = {};
    try{ sent = JSON.parse(localStorage.getItem('goldpilotAlertedSetups') || '{}'); }catch(e){ sent = {}; }
    readyRows.forEach(row => {
      commitWatchlistSignal(row);
      const key = `${new Date().toISOString().slice(0,10)}|${row.symbol}|${row.status}|${row.entry}|${row.stopLoss}|${row.tp1}`;
      if(sent[key]) return;
      sent[key] = Date.now();
      const message = `${row.symbol}: ${row.grade || ''} ${row.status} ${row.side || ''} entry ${fmtPrice(row.entry)} SL ${fmtPrice(row.stopLoss)} TP1 ${fmtPrice(row.tp1)}`;
      console.info('GoldPilot alert:', message);
      pushMobileAlert('GoldPilot setup ready', message, `watch|${key}`);
    });
    localStorage.setItem('goldpilotAlertedSetups', JSON.stringify(sent));
  }

  function commitWatchlistSignal(row){
    if(!row || !row.committable || !row.plan) return null;
    const signals = loadCommittedSignals();
    const key = committedKey(row.symbol, '15M');
    const signature = planSignature(row.plan);
    const existing = signals[key];
    if(existing && existing.active){
      upsertDemoTradeFromSignal(existing);
      return existing;
    }
    if(existing && !existing.active && existing.planSignature === signature) return null;
    const signal = {
      id:`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key,
      active:true,
      symbol:row.symbol,
      timeframe:'15M',
      timestamp:new Date().toISOString(),
      setup:row.setupObj || {setup:row.setup, direction:row.side},
      preferredDirection:row.side,
      plan:row.plan,
      planSignature:signature,
      risk:row.risk || accountForSymbol(row.symbol),
      signalGrade:{grade:row.grade, committable:true},
      entryReadinessScore:row.score || 0,
      reason:[row.reason || 'Watchlist committed setup']
    };
    signals[key] = signal;
    saveCommittedSignals(signals);
    upsertDemoTradeFromSignal(signal);
    return signal;
  }

  function renderBottomBar(decision){
    const session = qs('.session-indicator span');
    if(session) session.textContent = `${decision.tradability.session} session`;
    const statValues = qsa('.stat-pill span');
    if(statValues[0]) statValues[0].textContent = fmt(decision.tradability.spread, 2);
    if(statValues[1]) statValues[1].textContent = fmt(decision.tradability.atr, 2);
    if(statValues[2]) statValues[2].textContent = `Binance ${CONFIG.symbol}`;
    if(statValues[3]) statValues[3].textContent = newsSourceStatus;
  }

  function renderDemoTrades(){
    const wrap = qs('#demo-trades');
    if(!wrap) return;
    const rows = loadDemoTrades().slice(0, 5);
    if(!rows.length){
      wrap.innerHTML = `<div class="demo-trade">
        <div class="demo-head"><span class="demo-symbol">-</span><span class="demo-status">Waiting</span></div>
        <div class="demo-line">Committed signals will open demo trades here.</div>
      </div>`;
      return;
    }
    wrap.innerHTML = rows.map(row => {
      const isClosed = row.status === 'CLOSED';
      const pnlClass = Number(row.pnl || 0) >= 0 ? 'win' : 'loss';
      const result = isClosed ? `${row.result || 'CLOSED'} @ ${fmtPrice(row.exitPrice)}` : row.status;
      return `<div class="demo-trade ${isClosed ? 'closed' : 'open'}">
        <div class="demo-head">
          <span class="demo-symbol">${escapeHtml(row.symbol)} ${escapeHtml(row.side || '')}</span>
          <span class="demo-status">${escapeHtml(result)}</span>
        </div>
        <div class="demo-line">${escapeHtml(row.timeframe || '-')} | Qty ${fmt(row.quantity || 0, 2)} | Entry ${fmtPrice(row.entry)}</div>
        <div class="demo-line">SL ${fmtPrice(row.stopLoss)} | TP1 ${fmtPrice(row.tp1)} | TP2 ${fmtPrice(row.tp2)}</div>
        <div class="demo-line demo-pnl ${pnlClass}">Demo PnL ${Number(row.pnl || 0) >= 0 ? '+' : ''}$${fmt(row.pnl || 0, 2)}</div>
      </div>`;
    }).join('');
  }

  function renderJournal(){
    const tbody = qs('#journal-rows');
    if(!tbody) return;
    const rows = loadJournal().slice(0, 40);
    if(!rows.length){
      tbody.innerHTML = '<tr><td colspan="10">No journal snapshots yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => {
      const statusClass = /ALLOWED|ENTRY READY|COMMITTED/.test(String(row.tradeStatus || '')) ? 'allowed'
        : row.tradeStatus === 'BLOCKED' ? 'blocked' : 'wait';
      return `<tr>
        <td>${escapeHtml(formatShortTime(row.timestamp))}</td>
        <td>${escapeHtml(row.timeframe || '-')}</td>
        <td><span class="journal-status ${statusClass}">${escapeHtml(row.tradeStatus || '-')}</span></td>
        <td>${escapeHtml(row.bias || '-')} ${row.biasConfidence ? `(${row.biasConfidence}%)` : ''}</td>
        <td>${escapeHtml(row.regime || '-')}</td>
        <td>${escapeHtml(row.setup || '-')}</td>
        <td>${fmtPrice(row.entry)}</td>
        <td>${fmtPrice(row.stopLoss)}</td>
        <td>${fmtPrice(row.tp1)}</td>
        <td>${row.riskReward ? `1:${fmt(row.riskReward, 2)}` : '-'}</td>
      </tr>`;
    }).join('');
  }

  function populateTradeSignalSelect(){
    const select = qs('#trade-source-signal');
    if(!select) return;
    const current = select.value;
    const rows = loadJournal().slice(0, 80);
    select.innerHTML = '<option value="">Latest decision snapshot</option>' + rows.map(row => {
      const label = `${formatShortTime(row.timestamp)} | ${row.timeframe || '-'} | ${row.tradeStatus || '-'} | ${row.setup || row.regime || '-'}`;
      return `<option value="${escapeHtml(row.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    if(current && rows.some(row => row.id === current)) select.value = current;
  }

  function getSelectedSignalForTrade(){
    const selectedId = qs('#trade-source-signal')?.value;
    if(selectedId){
      const row = loadJournal().find(item => item.id === selectedId);
      if(row) return row;
    }
    if(lastDecision) return createJournalRow(lastDecision, 'trade-source');
    return null;
  }

  function createTradeReviewRow(){
    const source = getSelectedSignalForTrade();
    if(!source) return null;
    const result = qs('#trade-result')?.value || 'breakeven';
    const reviewType = qs('#trade-review-type')?.value || 'valid';
    const lossPct = Math.max(0, Number(qs('#trade-loss-pct')?.value || 0));
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      sourceSignalId: source.id || null,
      symbol: source.symbol || CONFIG.symbol,
      timeframe: source.timeframe || activeTimeframe,
      tradeStatus: source.tradeStatus || null,
      bias: source.bias || null,
      regime: source.regime || null,
      setup: source.setup || null,
      setupQuality: source.setupQuality || null,
      entry: source.entry || null,
      stopLoss: source.stopLoss || null,
      tp1: source.tp1 || null,
      tp2: source.tp2 || null,
      riskReward: source.riskReward || null,
      lotSize: source.lotSize || null,
      riskPct: source.riskPct || settings.riskPct,
      maxLoss: source.maxLoss || null,
      result,
      reviewType,
      lossPct,
      notes: qs('#trade-notes')?.value || ''
    };
  }

  function appendTradeReview(){
    const row = createTradeReviewRow();
    if(!row) return false;
    const rows = loadTradeJournal();
    rows.unshift(row);
    saveTradeJournal(rows);
    renderTradeJournal();
    populateTradeSignalSelect();
    if(lastDecision) renderRisk(lastDecision);
    const notes = qs('#trade-notes');
    if(notes) notes.value = '';
    const loss = qs('#trade-loss-pct');
    if(loss) loss.value = row.result === 'loss' ? row.lossPct : 0;
    return true;
  }

  function renderTradeJournal(){
    const tbody = qs('#trade-journal-rows');
    if(!tbody) return;
    const rows = loadTradeJournal().slice(0, 50);
    if(!rows.length){
      tbody.innerHTML = '<tr><td colspan="10">No reviewed trades yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(row => {
      const resultClass = row.result === 'win' ? 'allowed' : row.result === 'loss' ? 'blocked' : 'wait';
      return `<tr>
        <td>${escapeHtml(formatShortTime(row.timestamp))}</td>
        <td>${escapeHtml(row.timeframe || '-')}</td>
        <td><span class="journal-status ${resultClass}">${escapeHtml(row.result || '-')}</span></td>
        <td>${escapeHtml(row.reviewType || '-')}</td>
        <td>${escapeHtml(row.setup || '-')}</td>
        <td>${fmtPrice(row.entry)}</td>
        <td>${fmtPrice(row.stopLoss)}</td>
        <td>${fmtPrice(row.tp1)}</td>
        <td>${row.riskReward ? `1:${fmt(row.riskReward, 2)}` : '-'}</td>
        <td>${fmt(row.lossPct || 0, 2)}%</td>
      </tr>`;
    }).join('');
  }

  function formatEventTime(value){
    const d = new Date(value);
    if(isNaN(d.getTime())) return String(value || 'Manual time');
    return d.toLocaleString();
  }

  function formatShortTime(value){
    const d = new Date(value);
    if(isNaN(d.getTime())) return String(value || '-');
    return d.toLocaleString([], {month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'});
  }

  function formatAge(value){
    const ms = Date.now() - Number(value || 0);
    if(!isFinite(ms) || ms < 0) return '-';
    const sec = Math.floor(ms / 1000);
    if(sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if(min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h`;
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function wireTabs(){
    qsa('.pill').forEach(p => {
      p.addEventListener('click', () => {
        qsa('.pill').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        const targetMap = {
          Dashboard: '#dashboard-section',
          Analysis: '.modules',
          Backtests: '#crypto-watchlist',
          Journal: '#journal-section',
          Settings: '#settings-section'
        };
        const target = qs(targetMap[p.textContent.trim()]);
        if(target) target.scrollIntoView({behavior:'smooth', block:'start'});
      });
    });
    qsa('.tf').forEach(t => {
      t.addEventListener('click', () => {
        qsa('.tf').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        activeTimeframe = t.textContent.trim().toUpperCase();
        if(candlesByTimeframe[activeTimeframe]){
          renderDashboard(buildDecision());
        }
      });
    });
  }

  function wireChartHover(){
    const chart = qs('svg.chart');
    if(!chart) return;
    chart.addEventListener('mousemove', updateChartHover);
    chart.addEventListener('mouseleave', clearChartHover);
    chart.addEventListener('touchstart', updateChartHover, {passive:true});
    chart.addEventListener('touchmove', updateChartHover, {passive:true});
    chart.addEventListener('touchend', clearChartHover);
  }

  function wireWatchlistClicks(){
    const watch = qs('#crypto-watchlist');
    if(watch){
      watch.addEventListener('click', ev => {
        const row = ev.target.closest('[data-symbol]');
        if(!row) return;
        setPrimarySymbol(row.getAttribute('data-symbol'), '15M');
        const top = qs('#dashboard-section');
        if(top) top.scrollIntoView({behavior:'smooth', block:'start'});
      });
    }
    const alerts = qs('#watchlist-alerts');
    if(alerts){
      alerts.addEventListener('click', ev => {
        const button = ev.target.closest('[data-symbol]');
        if(!button) return;
        setPrimarySymbol(button.getAttribute('data-symbol'), '15M');
        const top = qs('#dashboard-section');
        if(top) top.scrollIntoView({behavior:'smooth', block:'start'});
      });
    }
  }

  function wireSettings(){
    syncSettingsForm();
    const form = qs('#risk-settings-form');
    if(form){
      form.addEventListener('submit', ev => {
        ev.preventDefault();
        saveSettings(readSettingsForm());
        if(Object.keys(candlesByTimeframe).length) renderDashboard(buildDecision());
      });
    }
    const reset = qs('#reset-risk-settings');
    if(reset){
      reset.addEventListener('click', () => {
        localStorage.removeItem('goldpilotRiskSettings');
        settings = loadSettings();
        syncSettingsForm();
        if(Object.keys(candlesByTimeframe).length) renderDashboard(buildDecision());
      });
    }
  }

  function wireSymbolPicker(){
    const picker = qs('#primary-symbol');
    if(!picker) return;
    picker.value = CONFIG.symbol;
    picker.addEventListener('change', () => setPrimarySymbol(picker.value));
  }

  function wireJournal(){
    renderJournal();
    renderTradeJournal();
    renderDemoTrades();
    populateTradeSignalSelect();
    const saveBtn = qs('#save-journal-snapshot');
    if(saveBtn){
      saveBtn.addEventListener('click', () => {
        if(lastDecision){
          appendJournalSnapshot(lastDecision, 'manual');
          renderRisk(lastDecision);
        }
      });
    }
    const clearBtn = qs('#clear-journal');
    if(clearBtn){
      clearBtn.addEventListener('click', () => {
        localStorage.removeItem('goldpilotSignalJournal');
        lastJournalSignature = null;
        renderJournal();
        if(lastDecision) renderRisk(lastDecision);
      });
    }

    const tradeForm = qs('#trade-review-form');
    if(tradeForm){
      tradeForm.addEventListener('submit', ev => {
        ev.preventDefault();
        appendTradeReview();
      });
    }
    const result = qs('#trade-result');
    if(result){
      result.addEventListener('change', () => {
        const loss = qs('#trade-loss-pct');
        const review = qs('#trade-review-type');
        if(result.value === 'loss'){
          if(loss && Number(loss.value) === 0) loss.value = settings.riskPct;
          if(review && review.value === 'valid') review.value = 'valid-loss';
        } else {
          if(loss) loss.value = 0;
          if(review && review.value === 'valid-loss') review.value = 'valid';
        }
      });
    }
    const clearTrades = qs('#clear-trade-journal');
    if(clearTrades){
      clearTrades.addEventListener('click', () => {
        localStorage.removeItem('goldpilotTradeJournal');
        renderTradeJournal();
        if(lastDecision) renderRisk(lastDecision);
      });
    }
  }

  function wireCommittedSignal(){
    const clear = qs('#clear-committed-signal');
    if(!clear) return;
    clear.addEventListener('click', () => {
      const signals = loadCommittedSignals();
      const key = committedKey();
      if(signals[key]){
        signals[key].active = false;
        signals[key].exitState = 'MANUAL_CLEAR';
        signals[key].closedAt = new Date().toISOString();
        saveCommittedSignals(signals);
      }
      if(Object.keys(candlesByTimeframe).length) renderDashboard(buildDecision());
    });
  }

  function wireMobileAlerts(){
    const btn = qs('#enable-mobile-alerts');
    if(!btn) return;
    syncMobileAlertButton();
    btn.addEventListener('click', () => {
      if(!('Notification' in window)){
        showMobileAlertStrip('Alerts unavailable', 'This browser does not support web notifications.');
        return;
      }
      if(Notification.permission === 'granted'){
        const next = mobileAlertsEnabled() ? 'disabled' : 'enabled';
        localStorage.setItem('goldpilotMobileAlerts', next);
        syncMobileAlertButton();
        showMobileAlertStrip('GoldPilot Alerts', next === 'enabled' ? 'Mobile alerts enabled.' : 'Mobile alerts disabled.');
        return;
      }
      if(Notification.permission === 'denied'){
        showMobileAlertStrip('Alerts blocked', 'Enable notifications for this site in browser settings.');
        syncMobileAlertButton();
        return;
      }
      Notification.requestPermission().then(permission => {
        if(permission === 'granted'){
          localStorage.setItem('goldpilotMobileAlerts', 'enabled');
          pushMobileAlert('GoldPilot Alerts Enabled', 'Committed/demo trade alerts will show on this device.', 'alerts-enabled');
        }
        syncMobileAlertButton();
      });
    });
  }

  function tickClock(){
    const n = new Date();
    const s = v => String(v).padStart(2, '0');
    setText('#clock', `${s(n.getUTCHours())}:${s(n.getUTCMinutes())}:${s(n.getUTCSeconds())} UTC`);
  }

  async function start(){
    wireTabs();
    wireChartHover();
    wireSettings();
    wireJournal();
    wireCommittedSignal();
    wireMobileAlerts();
    wireSymbolPicker();
    wireWatchlistClicks();
    tickClock();
    setInterval(tickClock, 1000);
    try{
      await refreshMarketData();
      scanWatchlist().catch(err => console.error('watchlist scan', err));
      refreshTimer = setInterval(() => {
        refreshMarketData().catch(err => {
          console.error(err);
          setConnection('DATA ERROR', 'var(--red)');
          setHtml('#status-reason', `<b>Data error.</b> ${escapeHtml(err.message)}. Keeping last rendered analysis.`);
        });
      }, CONFIG.refreshMs);
      watchlistTimer = setInterval(() => {
        scanWatchlist().catch(err => console.error('watchlist scan', err));
      }, Math.max(CONFIG.refreshMs * 2, 120000));
    } catch(err){
      console.error(err);
      setConnection('DATA ERROR', 'var(--red)');
      setHtml('#status-reason', `<b>Data error.</b> ${escapeHtml(err.message)}. Check internet access or Binance availability.`);
    }
  }

  window.GoldPilotDashboard = {
    refresh: refreshMarketData,
    setPrimarySymbol,
    scanWatchlist,
    getState: () => ({candlesByTimeframe, latestTicker, refreshTimer, watchlistTimer, activeTimeframe, settings, watchlistRows, config: CONFIG})
  };

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
