(function(){
  const CONFIG = {
    symbol: 'PAXGUSDT',
    displayName: 'PAXGUSDT gold proxy',
    primaryTimeframe: '15m',
    refreshMs: 60000,
    candlesLimit: 240,
    cloudApiBase: '',
    marketApiBase: '',
    allowIndianCacheFallback: false,
    account: {
      balance: 1000,
      riskPct: 1,
      minLot: 0.01,
      tickValuePerLot: 1,
      maxDailyLossPct: 3,
      maxTradesPerDay: 3,
      aiEnabled: false,
      aiModel: 'qwen2.5:3b',
      aiEndpoint: 'http://localhost:11434/api/chat'
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
    '^NSEI','^NSEBANK','^BSESN',
    'PAXGUSDT','BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
    'ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','MATICUSDT','DOTUSDT'
  ];
  const MARKET_PROFILES = {
    'PAXGUSDT': {
      symbol:'PAXGUSDT',
      displayName:'PAXGUSDT gold proxy',
      dataSource:'binance',
      marketType:'crypto_gold_proxy',
      sizingMode:'BINANCE_SPOT_QUANTITY',
      minLot:0.01,
      tickValuePerLot:1
    },
    '^NSEI': {
      symbol:'^NSEI',
      displayName:'NIFTY 50 index',
      dataSource:'yahoo',
      yahooSymbol:'^NSEI',
      marketType:'indian_index',
      exchange:'NSE',
      indexName:'NIFTY 50',
      sizingMode:'INDEX_POINT_QUANTITY',
      minLot:1,
      tickValuePerLot:1,
      maxSpreadPct:0,
      newsCurrencies:['INR','IN','INDIA']
    },
    '^NSEBANK': {
      symbol:'^NSEBANK',
      displayName:'BANK NIFTY index',
      dataSource:'yahoo',
      yahooSymbol:'^NSEBANK',
      marketType:'indian_index',
      exchange:'NSE',
      indexName:'BANK NIFTY',
      sizingMode:'INDEX_POINT_QUANTITY',
      minLot:1,
      tickValuePerLot:1,
      maxSpreadPct:0,
      newsCurrencies:['INR','IN','INDIA']
    },
    '^BSESN': {
      symbol:'^BSESN',
      displayName:'SENSEX index',
      dataSource:'yahoo',
      yahooSymbol:'^BSESN',
      marketType:'indian_index',
      exchange:'BSE',
      indexName:'SENSEX',
      sizingMode:'INDEX_POINT_QUANTITY',
      minLot:1,
      tickValuePerLot:1,
      maxSpreadPct:0,
      newsCurrencies:['INR','IN','INDIA']
    }
  };
  const YAHOO_INTERVALS = {
    '1m': {interval:'1m', range:'1d'},
    '5m': {interval:'5m', range:'5d'},
    '15m': {interval:'15m', range:'5d'},
    '1h': {interval:'60m', range:'1mo'},
    '4h': {interval:'60m', range:'3mo', aggregate:4},
    '1d': {interval:'1d', range:'1y'}
  };

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
  let marketDataSourceMode = 'live';
  let cloudHydrated = false;
  let cloudSyncTimer = null;
  let cloudSyncInFlight = false;
  const aiDecisionCache = {};
  const aiDecisionInFlight = {};

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
  function candleChangePct(candles){
    const rows = confirmedCandles(candles || []);
    if(rows.length < 2) return null;
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if(!prev || !prev.c || !last || !isFinite(last.c)) return null;
    return (last.c - prev.c) / prev.c * 100;
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

  function profileForSymbol(symbol=CONFIG.symbol){
    const normalized = normalizeMarketSymbol(symbol);
    return MARKET_PROFILES[normalized] || {
      symbol:normalized,
      displayName:normalized,
      dataSource:'binance',
      marketType:/USDT|BTC|ETH|BNB|SOL|DOGE|XRP|ADA|AVAX|MATIC|DOT|LINK/.test(normalized) ? 'crypto' : 'market',
      sizingMode:'BINANCE_SPOT_QUANTITY',
      minLot:0.01,
      tickValuePerLot:1
    };
  }

  function normalizeMarketSymbol(symbol){
    const raw = String(symbol || '').toUpperCase().trim().replace(/\s+/g, '');
    const aliases = {
      NIFTY:'^NSEI',
      NIFTY50:'^NSEI',
      NSEI:'^NSEI',
      BANKNIFTY:'^NSEBANK',
      NIFTYBANK:'^NSEBANK',
      NSEBANK:'^NSEBANK',
      SENSEX:'^BSESN',
      BSESN:'^BSESN'
    };
    return aliases[raw] || raw;
  }

  function displayNameForSymbol(symbol){
    const profile = profileForSymbol(symbol);
    if(profile.displayName) return profile.displayName;
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
      maxTradesPerDay: Math.max(1, Math.round(Number(raw.maxTradesPerDay) || CONFIG.account.maxTradesPerDay)),
      aiEnabled: raw.aiEnabled === true || raw.aiEnabled === 'true' || raw.aiEnabled === 'on',
      aiModel: String(raw.aiModel || CONFIG.account.aiModel),
      aiEndpoint: String(raw.aiEndpoint || CONFIG.account.aiEndpoint)
    };
  }

  function accountForSymbol(symbol=CONFIG.symbol, overrides={}){
    const profile = profileForSymbol(symbol);
    return Object.assign({}, settings, overrides, {
      symbol,
      marketType:profile.marketType,
      exchange:profile.exchange || null,
      indexName:profile.indexName || null,
      sizingMode:profile.sizingMode || 'BINANCE_SPOT_QUANTITY',
      minLot:profile.minLot || settings.minLot,
      tickValuePerLot:profile.tickValuePerLot || 1,
      maxSpreadPct:profile.maxSpreadPct,
      newsCurrencies:profile.newsCurrencies
    });
  }

  function clampNumber(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  function cloudApiBase(){
    const explicit = window.GOLDPILOT_API_BASE || localStorage.getItem('goldpilotCloudApiBase') || CONFIG.cloudApiBase;
    if(explicit) return String(explicit).replace(/\/$/, '');
    return '';
  }

  function cloudApiEnabled(){
    return !!cloudApiBase();
  }

  function marketApiBase(){
    const explicit = window.GOLDPILOT_MARKET_API_BASE
      || localStorage.getItem('goldpilotMarketApiBase')
      || window.GOLDPILOT_API_BASE
      || localStorage.getItem('goldpilotCloudApiBase')
      || CONFIG.marketApiBase
      || CONFIG.cloudApiBase;
    if(explicit) return String(explicit).replace(/\/$/, '');
    return inferredWorkersDevBase('goldpilot-market-data');
  }

  function marketApiEnabled(){
    return !!marketApiBase();
  }

  function inferredWorkersDevBase(workerName){
    if(!location || !/\.workers\.dev$/i.test(location.hostname)) return '';
    const parts = location.hostname.split('.');
    if(parts.length < 4) return '';
    const subdomain = parts[1];
    if(!subdomain || parts[0] === workerName) return location.origin;
    return `https://${workerName}.${subdomain}.workers.dev`;
  }

  function shouldTryDirectYahoo(){
    return false;
  }

  function marketDataErrorHint(symbol, err){
    const profile = profileForSymbol(symbol);
    const reason = err && err.message ? err.message : String(err || 'Unknown data error');
    if(profile.dataSource === 'yahoo' && !marketApiEnabled()){
      return `${reason}. Indian index data needs the GoldPilot market-data worker because Yahoo blocks browser requests. Deploy indian_market_worker and set localStorage.goldpilotMarketApiBase to the worker URL.`;
    }
    return reason;
  }

  async function cloudApi(path, options={}){
    const base = cloudApiBase();
    if(!base) throw new Error('Cloud API base is not configured');
    const res = await fetch(`${base}${path}`, Object.assign({
      headers:{'content-type':'application/json'}
    }, options));
    if(!res.ok) throw new Error(`Cloud API ${res.status}`);
    return res.json();
  }

  async function marketApi(path, options={}){
    const base = marketApiBase();
    if(!base) throw new Error('Market API base is not configured');
    const res = await fetch(`${base}${path}`, Object.assign({
      headers:{'content-type':'application/json'}
    }, options));
    if(!res.ok) throw new Error(`Market API ${res.status}`);
    return res.json();
  }

  function currentDemoState(){
    return {
      settings,
      committedSignals:loadCommittedSignals(),
      demoTrades:loadDemoTrades()
    };
  }

  function scheduleCloudDemoSync(){
    if(!cloudHydrated || !cloudApiEnabled()) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      syncCloudDemoState().catch(err => console.warn('cloud demo sync failed', err));
    }, 700);
  }

  async function syncCloudDemoState(){
    if(!cloudApiEnabled() || cloudSyncInFlight) return;
    cloudSyncInFlight = true;
    try{
      await cloudApi('/api/demo-state', {
        method:'POST',
        body:JSON.stringify(currentDemoState())
      });
    } finally {
      cloudSyncInFlight = false;
    }
  }

  async function hydrateCloudDemoState(){
    if(!cloudApiEnabled()){
      cloudHydrated = true;
      return;
    }
    try{
      const data = await cloudApi('/api/demo-state');
      const state = data && data.state || {};
      const hasCloudState = !!(state.settings || state.committedSignals || state.demoTrades);
      if(state.settings){
        settings = sanitizeSettings(state.settings);
        localStorage.setItem('goldpilotRiskSettings', JSON.stringify(settings));
        syncSettingsForm();
      }
      if(state.committedSignals && typeof state.committedSignals === 'object'){
        localStorage.setItem('goldpilotCommittedSignals', JSON.stringify(state.committedSignals));
      }
      if(Array.isArray(state.demoTrades)){
        localStorage.setItem('goldpilotDemoTrades', JSON.stringify(state.demoTrades.slice(0, 25)));
      }
      cloudHydrated = true;
      if(!hasCloudState) scheduleCloudDemoSync();
    } catch(err){
      cloudHydrated = true;
      console.warn('cloud demo hydrate failed; using local state', err);
    }
  }

  function saveSettings(nextSettings){
    settings = sanitizeSettings(nextSettings);
    localStorage.setItem('goldpilotRiskSettings', JSON.stringify(settings));
    syncSettingsForm();
    scheduleCloudDemoSync();
  }

  function readSettingsForm(){
    return sanitizeSettings({
      balance: qs('#setting-balance')?.value,
      riskPct: qs('#setting-risk-pct')?.value,
      minLot: qs('#setting-min-lot')?.value,
      tickValuePerLot: qs('#setting-tick-value')?.value,
      maxDailyLossPct: qs('#setting-daily-loss')?.value,
      maxTradesPerDay: qs('#setting-max-trades')?.value,
      aiEnabled: qs('#setting-ai-enabled')?.checked,
      aiModel: qs('#setting-ai-model')?.value,
      aiEndpoint: qs('#setting-ai-endpoint')?.value
    });
  }

  function syncSettingsForm(){
    const pairs = [
      ['#setting-balance', settings.balance],
      ['#setting-risk-pct', settings.riskPct],
      ['#setting-min-lot', settings.minLot],
      ['#setting-tick-value', settings.tickValuePerLot],
      ['#setting-daily-loss', settings.maxDailyLossPct],
      ['#setting-max-trades', settings.maxTradesPerDay],
      ['#setting-ai-model', settings.aiModel],
      ['#setting-ai-endpoint', settings.aiEndpoint]
    ];
    pairs.forEach(([selector, value]) => {
      const el = qs(selector);
      if(el) el.value = value;
    });
    const ai = qs('#setting-ai-enabled');
    if(ai) ai.checked = !!settings.aiEnabled;
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

  function loadGeneratedStrategies(){
    try{
      const rows = JSON.parse(localStorage.getItem('goldpilotGeneratedStrategies') || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch(e){
      return [];
    }
  }

  function saveGeneratedStrategies(rows){
    localStorage.setItem('goldpilotGeneratedStrategies', JSON.stringify(rows.slice(0, 150)));
  }

  function saveGeneratedStrategy(decision){
    const strategy = decision && decision.marketBrain && decision.marketBrain.generatedStrategy;
    if(!strategy || !strategy.id) return false;
    const rows = loadGeneratedStrategies();
    const key = `${CONFIG.symbol}|${activeTimeframe}|${strategy.id}|${strategy.decision}|${strategy.decisionMode}`;
    const existing = rows.find(row => row.key === key);
    const payload = Object.assign({}, strategy, {
      key,
      symbol:CONFIG.symbol,
      timeframe:activeTimeframe,
      savedAt:new Date().toISOString(),
      tradeStatus:decision.tradeStatus,
      setup:decision.setup && decision.setup.setup,
      brainAction:decision.marketBrain.action,
      commitDecision:decision.marketBrain.commitDecision
    });
    if(existing){
      Object.assign(existing, payload, {seenCount:Number(existing.seenCount || 1) + 1});
    } else {
      rows.unshift(Object.assign({seenCount:1}, payload));
    }
    saveGeneratedStrategies(rows);
    return true;
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
    scheduleCloudDemoSync();
  }

  function closeCommittedSignalForDemo(row){
    if(!row || !row.signalId) return;
    const signals = loadCommittedSignals();
    let changed = false;
    Object.keys(signals).forEach(key => {
      const signal = signals[key];
      if(!signal || signal.id !== row.signalId || !signal.active) return;
      signal.active = false;
      signal.exitState = row.result || 'CLOSED';
      signal.closedAt = row.closedAt || new Date().toISOString();
      signal.exitPrice = row.exitPrice;
      changed = true;
    });
    if(changed) saveCommittedSignals(signals);
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
    scheduleCloudDemoSync();
  }

  function pnlForQuantity(trade, price, quantity){
    if(!trade || price == null) return 0;
    const direction = trade.side === 'LONG' ? 1 : -1;
    return (price - trade.entry) * direction * Number(quantity || 0);
  }

  function settleDemoBalance(row){
    if(!row || row.balanceSettled || row.status !== 'CLOSED') return false;
    const realized = roundLocal(Number(row.realizedPnl != null ? row.realizedPnl : row.pnl || 0), 4);
    const nextBalance = Math.max(0, roundLocal(Number(settings.balance || 0) + realized, 2));
    row.balanceBefore = roundLocal(settings.balance || 0, 2);
    row.balanceAfter = nextBalance;
    row.balanceSettled = true;
    row.settledAt = new Date().toISOString();
    saveSettings(Object.assign({}, settings, {balance:nextBalance}));
    return true;
  }

  function committedKey(symbol=CONFIG.symbol, timeframe=activeTimeframe){
    return `${String(symbol).toUpperCase()}|${String(timeframe).toUpperCase()}`;
  }

  function planSignature(plan){
    if(!plan) return '';
    return [plan.side, plan.entry, plan.stopLoss, plan.takeProfit && plan.takeProfit.tp1, plan.takeProfit && plan.takeProfit.tp2, plan.takeProfit && plan.takeProfit.tp3].join('|');
  }

  function currentMarketPrice(){
    const candles = candlesByTimeframe[activeTimeframe] || candlesByTimeframe['15M'] || [];
    const latestCandle = candles[candles.length - 1];
    return latestTicker && latestTicker.last ? latestTicker.last : latestCandle ? latestCandle.c : null;
  }

  function planPriceReference(){
    const price = currentMarketPrice();
    if(price != null && isFinite(Number(price)) && Number(price) > 0) return Number(price);
    const candles = candlesByTimeframe[activeTimeframe] || candlesByTimeframe['15M'] || [];
    const latestCandle = candles[candles.length - 1];
    return latestCandle && latestCandle.c > 0 ? Number(latestCandle.c) : null;
  }

  function isTradePlanPriceCompatible(plan, referencePrice=planPriceReference()){
    if(!plan || referencePrice == null || !isFinite(Number(referencePrice)) || Number(referencePrice) <= 0) return !!plan;
    const ref = Number(referencePrice);
    const entry = Number(plan.entry);
    if(!isFinite(entry) || entry <= 0) return false;
    const entryRatio = entry / ref;
    if(entryRatio < 0.25 || entryRatio > 4) return false;
    const zone = Array.isArray(plan.entryZone) ? plan.entryZone.map(Number).filter(Number.isFinite) : [];
    if(zone.length){
      const center = zone.reduce((sum, value) => sum + value, 0) / zone.length;
      const zoneRatio = center / ref;
      if(zoneRatio < 0.25 || zoneRatio > 4) return false;
    }
    return true;
  }

  async function fetchSymbolLastPrice(symbol){
    const normalized = normalizeMarketSymbol(symbol);
    if(!normalized) return null;
    if(normalized === CONFIG.symbol){
      const current = currentMarketPrice();
      if(current != null) return current;
    }
    const profile = profileForSymbol(normalized);
    if(profile.dataSource === 'yahoo'){
      const rows = await fetchYahooKlines('1d', 5, normalized);
      const last = rows[rows.length - 1];
      return last ? Number(last.c) : null;
    }
    const ticker = await fetchJson(`https://api.binance.com/api/v3/ticker/price?symbol=${normalized}`);
    return Number(ticker.price);
  }

  async function demoTradePrices(rows){
    const openSymbols = [...new Set((rows || [])
      .filter(row => row && row.status !== 'CLOSED')
      .map(row => String(row.symbol || '').toUpperCase())
      .filter(Boolean))];
    const pairs = await Promise.allSettled(openSymbols.map(async symbol => [symbol, await fetchSymbolLastPrice(symbol)]));
    const prices = {};
    pairs.forEach(result => {
      if(result.status !== 'fulfilled') return;
      const [symbol, price] = result.value;
      if(isFinite(price)) prices[symbol] = price;
    });
    return prices;
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
    const openQty = Number(trade.openQuantity != null ? trade.openQuantity : trade.quantity || 0);
    return Number(trade.realizedPnl || 0) + pnlForQuantity(trade, price, openQty);
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
      tp3:plan.takeProfit ? plan.takeProfit.tp3 : null,
      tpModel:plan.takeProfit ? plan.takeProfit.model : null,
      tpPartials:plan.takeProfit && plan.takeProfit.partials ? plan.takeProfit.partials : {tp1:40,tp2:35,tp3:25},
      atrTrail:plan.takeProfit ? plan.takeProfit.trail : null,
      maxHoldCandles:plan.takeProfit ? plan.takeProfit.maxHoldCandles : 12,
      quantity,
      initialQuantity:quantity,
      openQuantity:quantity,
      reservedRisk:roundLocal(Math.abs(plan.entry - plan.stopLoss) * quantity, 4),
      riskPct:risk.riskPct || settings.riskPct,
      pnl:0,
      realizedPnl:0,
      maxFavorable:0,
      maxAdverse:0
    };
    rows.unshift(row);
    saveDemoTrades(rows);
    return row;
  }

  async function updateDemoTrades(){
    const rows = loadDemoTrades();
    const prices = await demoTradePrices(rows);
    let changed = false;
    rows.forEach(row => {
      if(row.status === 'CLOSED'){
        if(settleDemoBalance(row)) changed = true;
        return;
      }
      const price = prices[String(row.symbol || '').toUpperCase()];
      if(price == null) return;
      const previousStatus = row.status;
      const pnl = demoTradePnl(row, price);
      row.pnl = roundLocal(pnl, 4);
      row.maxFavorable = Math.max(Number(row.maxFavorable || 0), row.pnl);
      row.maxAdverse = Math.min(Number(row.maxAdverse || 0), row.pnl);
      const initialQty = Number(row.initialQuantity || row.quantity || 0);
      if(row.openQuantity == null) row.openQuantity = Number(row.quantity || 0);
      const partials = row.tpPartials || {tp1:40,tp2:35,tp3:25};
      const takePartial = exitPrice => {
        if(row.tp1Settled) return;
        const partialQty = roundLocal(initialQty * (Number(partials.tp1 || 40) / 100), 8);
        row.realizedPnl = roundLocal(Number(row.realizedPnl || 0) + pnlForQuantity(row, exitPrice, partialQty), 4);
        row.openQuantity = Math.max(0, roundLocal(Number(row.openQuantity || initialQty) - partialQty, 8));
        row.tp1Settled = true;
        row.partialClosedQty = partialQty;
        row.partialClosedAt = new Date().toISOString();
        row.partialExitPrice = exitPrice;
      };
      const takeTp2Partial = exitPrice => {
        if(row.tp2Settled) return;
        const partialQty = Math.min(Number(row.openQuantity || 0), roundLocal(initialQty * (Number(partials.tp2 || 35) / 100), 8));
        row.realizedPnl = roundLocal(Number(row.realizedPnl || 0) + pnlForQuantity(row, exitPrice, partialQty), 4);
        row.openQuantity = Math.max(0, roundLocal(Number(row.openQuantity || 0) - partialQty, 8));
        row.tp2Settled = true;
        row.tp2ClosedQty = partialQty;
        row.tp2ClosedAt = new Date().toISOString();
        row.tp2ExitPrice = exitPrice;
      };
      const closeRemaining = (result, exitPrice) => {
        const openQty = Number(row.openQuantity != null ? row.openQuantity : row.quantity || 0);
        row.realizedPnl = roundLocal(Number(row.realizedPnl || 0) + pnlForQuantity(row, exitPrice, openQty), 4);
        row.openQuantity = 0;
        row.pnl = row.realizedPnl;
        row.status = 'CLOSED';
        row.result = result;
        row.closedAt = new Date().toISOString();
        row.exitPrice = exitPrice;
        settleDemoBalance(row);
        closeCommittedSignalForDemo(row);
      };
      if(row.side === 'LONG'){
        if((row.status === 'TP1_HIT' || row.status === 'TP2_HIT') && price <= row.entry){ closeRemaining('BREAKEVEN', row.entry); }
        else if(price <= row.stopLoss){ closeRemaining('SL', row.stopLoss); }
        else if(row.tp3 && price >= row.tp3){ closeRemaining('TP3', row.tp3); }
        else if(row.tp2 && price >= row.tp2){ takeTp2Partial(row.tp2); row.status = 'TP2_HIT'; row.pnl = roundLocal(demoTradePnl(row, price), 4); }
        else if(row.tp1 && price >= row.tp1){ takePartial(row.tp1); row.status = 'TP1_HIT'; row.breakEvenArmed = true; row.stopLoss = row.entry; row.pnl = roundLocal(demoTradePnl(row, price), 4); }
      } else {
        if((row.status === 'TP1_HIT' || row.status === 'TP2_HIT') && price >= row.entry){ closeRemaining('BREAKEVEN', row.entry); }
        else if(price >= row.stopLoss){ closeRemaining('SL', row.stopLoss); }
        else if(row.tp3 && price <= row.tp3){ closeRemaining('TP3', row.tp3); }
        else if(row.tp2 && price <= row.tp2){ takeTp2Partial(row.tp2); row.status = 'TP2_HIT'; row.pnl = roundLocal(demoTradePnl(row, price), 4); }
        else if(row.tp1 && price <= row.tp1){ takePartial(row.tp1); row.status = 'TP1_HIT'; row.breakEvenArmed = true; row.stopLoss = row.entry; row.pnl = roundLocal(demoTradePnl(row, price), 4); }
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
    if(!isTradePlanPriceCompatible(decision.tradePlan)) return null;
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
    const final = decision && decision.finalTradeDecision ? decision.finalTradeDecision : resolveFinalTradeDecision(decision);
    if(!(final && final.allowCommit && decision && decision.tradePlan)) return false;
    if(!isTradePlanPriceCompatible(decision.tradePlan)) return false;
    return true;
  }

  function brainApprovesCommit(decision){
    const brain = decision && decision.marketBrain;
    return !!(brain && (brain.commitDecision === 'COMMIT' || (brain.adaptive && brain.adaptive.canCommit === true)));
  }

  function aiDecisionAllowsWatch(decision){
    const ai = decision && (decision.aiDecision || aiDecisionCache[decisionSignature(decision)]);
    return !!(ai && ['WAIT','BLOCK','LATE'].includes(ai.finalDecision));
  }

  function priceInsideEntryZone(plan){
    if(!plan || !Array.isArray(plan.entryZone) || plan.entryZone.length < 2) return true;
    const price = currentMarketPrice();
    if(price == null || !isFinite(Number(price))) return false;
    const low = Math.min(Number(plan.entryZone[0]), Number(plan.entryZone[1]));
    const high = Math.max(Number(plan.entryZone[0]), Number(plan.entryZone[1]));
    return Number(price) >= low && Number(price) <= high;
  }

  function resolveFinalTradeDecision(decision){
    if(!decision) return null;
    const brain = decision.marketBrain || {};
    const adaptive = brain.adaptive || {};
    const generated = brain.generatedStrategy || adaptive.generatedStrategy || null;
    const plan = decision.tradePlan || null;
    const ai = decision.aiDecision || aiDecisionCache[decisionSignature(decision)] || null;
    const aiReasons = ai && Array.isArray(ai.reasonCodes) ? ai.reasonCodes : [];
    const brainCommit = brainApprovesCommit(decision);
    const inZone = priceInsideEntryZone(plan);
    const direction = plan ? plan.side : generated ? generated.direction : decision.preferredDirection || 'WAIT';
    const base = {
      finalAction:'WAIT',
      label:'WAIT',
      allowCommit:false,
      direction,
      confidence:brain.confidence || adaptive.evidenceScore || 0,
      source:'ENGINE_BRAIN',
      reason:'Waiting for the brain to finish decision synthesis.',
      strategy:generated ? generated.name : brain.playbook || null,
      decisionMode:brain.decisionMode || adaptive.decisionMode || 'OBSERVE',
      entryZone:plan && plan.entryZone || null,
      invalidation:plan && plan.invalidation || plan && plan.stopLoss || null,
      priceInEntryZone:inZone
    };
    if(decision.tradeStatus && decision.tradeStatus.includes('COMMITTED')){
      return Object.assign(base, {finalAction:'MANAGE', label:decision.tradeStatus, allowCommit:false, source:'COMMITTED_SIGNAL', reason:'A committed signal is already active.'});
    }
    if(decision.tradeStatus === 'BLOCKED' || brain.action === 'BLOCK'){
      return Object.assign(base, {finalAction:'BLOCK', label:'BLOCK', source:'RISK_BLOCK', reason:(brain.warnings && brain.warnings[0]) || (decision.reason || ['Risk block active'])[0] || 'Risk block active.'});
    }
    if(settings.aiEnabled && !ai){
      return Object.assign(base, {finalAction:'WAIT_FOR_OLLAMA', label:'WAIT - Ollama pending', source:'OLLAMA_PENDING', reason:'Ollama is enabled, so final trade permission waits for Ollama approval.'});
    }
    if(settings.aiEnabled && ai){
      const aiConfidence = Number(ai.confidence || 0);
      if(aiReasons.includes('ollama_unavailable')){
        return Object.assign(base, {finalAction:'WAIT_FOR_OLLAMA', label:'WAIT - Ollama unavailable', source:'OLLAMA_UNAVAILABLE', confidence:0, reason:ai.nextTrigger || 'Ollama is unavailable, so final permission is not granted.'});
      }
      if(ai.finalDecision === 'BLOCK' || ai.finalDecision === 'LATE' || ai.isLate === true){
        return Object.assign(base, {finalAction:ai.finalDecision === 'LATE' ? 'LATE' : 'BLOCK', label:`${ai.finalDecision} ${ai.bestDirection}`, source:'OLLAMA', confidence:aiConfidence, reason:ai.nextTrigger || 'Ollama blocked the trade.'});
      }
      if(ai.finalDecision !== 'APPROVE' || aiConfidence < 65){
        return Object.assign(base, {finalAction:'WAIT', label:`${ai.finalDecision || 'WAIT'} ${ai.bestDirection || 'WAIT'}`, source:'OLLAMA', confidence:aiConfidence, reason:ai.nextTrigger || 'Ollama has not approved the trade.'});
      }
    }
    if(!brainCommit){
      const action = adaptive.verdict === 'ALERT' || brain.action === 'ALERT' ? 'ALERT' : 'WAIT';
      return Object.assign(base, {finalAction:action, label:action, source:settings.aiEnabled ? 'OLLAMA_APPROVED_ENGINE_WAIT' : 'ENGINE_BRAIN', reason:generated ? generated.marketRead : brain.nextTrigger || 'Generated strategy is not commit-ready yet.'});
    }
    if(!inZone){
      return Object.assign(base, {finalAction:'WAIT_FOR_ENTRY', label:`WAIT FOR ${direction} ENTRY`, source:settings.aiEnabled ? 'OLLAMA_AND_ENGINE' : 'ENGINE_BRAIN', reason:'Brain approves the strategy, but current price is outside the valid entry zone.'});
    }
    return Object.assign(base, {
      finalAction:'COMMIT',
      label:`COMMIT ${direction}`,
      allowCommit:true,
      source:settings.aiEnabled ? 'OLLAMA_AND_ENGINE' : 'ENGINE_BRAIN',
      confidence:settings.aiEnabled && ai ? Number(ai.confidence || 0) : base.confidence,
      reason:generated ? generated.marketRead : brain.nextTrigger || 'Brain and risk conditions approve this trade.'
    });
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

  function buildAiDecisionFacts(decision){
    const plan = displayTradePlan(decision);
    const setup = displaySetup(decision);
    return {
      symbol:CONFIG.symbol,
      timeframe:activeTimeframe,
      tradeStatus:decision.tradeStatus,
      setupStage:decision.setupStage,
      setup:setup ? setup.setup : null,
      side:plan ? plan.side : decision.preferredDirection,
      bias:decision.bias,
      regime:decision.regime,
      masterScore:decision.masterScore,
      signalGrade:decision.signalGrade,
      liquidity:{
        nearest:decision.liquidityMap ? decision.liquidityMap.actionableNearest || decision.liquidityMap.nearest : [],
        warning:decision.liquidityMap ? decision.liquidityMap.warning : null
      },
      candle:decision.candleBehavior,
      location:decision.locationContext,
      trendQuality:decision.trendQuality,
      cryptoRisk:decision.cryptoContext,
      htfAlignment:decision.htfAlignment,
      sessionRules:decision.sessionRules,
      generatedStrategy:decision.marketBrain ? decision.marketBrain.generatedStrategy : null,
      brainDecisionMode:decision.marketBrain ? decision.marketBrain.decisionMode : null,
      tradePlan:plan ? {
        side:plan.side,
        entry:plan.entry,
        entryZone:plan.entryZone,
        stopLoss:plan.stopLoss,
        takeProfit:plan.takeProfit,
        riskReward:plan.riskReward,
        targetQuality:plan.targetQuality,
        targetWarning:plan.targetWarning
      } : null,
      missingConditions:decision.missingConditions,
      engineReasons:decision.reason,
      nextConditionNeeded:decision.nextConditionNeeded,
      requiredOutput:{
        finalDecision:'APPROVE | WAIT | BLOCK | LATE',
        bestDirection:'LONG | SHORT | WAIT',
        longProbability:'0-100',
        shortProbability:'0-100',
        waitProbability:'0-100',
        entryTiming:'EARLY_FORMING | ENTRY_READY | LATE | NO_TRADE',
        isLate:'boolean',
        nextTrigger:'string',
        entryZone:'array or null',
        invalidation:'number or null',
        confidence:'0-100',
        reasonCodes:'array of snake_case strings'
      }
    };
  }

  function extractJsonObject(text){
    const raw = String(text || '').trim();
    try{ return JSON.parse(raw); }catch(e){}
    const match = raw.match(/\{[\s\S]*\}/);
    if(match){
      try{ return JSON.parse(match[0]); }catch(e){}
    }
    return null;
  }

  function normalizeAiDecision(raw){
    if(!raw || typeof raw !== 'object') return null;
    const allowed = ['APPROVE','WAIT','BLOCK','LATE'];
    const finalDecision = allowed.includes(String(raw.finalDecision || '').toUpperCase())
      ? String(raw.finalDecision).toUpperCase()
      : 'WAIT';
    return {
      finalDecision,
      bestDirection:String(raw.bestDirection || 'WAIT').toUpperCase(),
      longProbability:clampNumber(Number(raw.longProbability) || 0, 0, 100),
      shortProbability:clampNumber(Number(raw.shortProbability) || 0, 0, 100),
      waitProbability:clampNumber(Number(raw.waitProbability) || 0, 0, 100),
      entryTiming:String(raw.entryTiming || 'NO_TRADE').toUpperCase(),
      isLate:raw.isLate === true || raw.isLate === 'true',
      nextTrigger:String(raw.nextTrigger || 'Wait for cleaner confirmation.'),
      entryZone:Array.isArray(raw.entryZone) ? raw.entryZone.slice(0, 2).map(Number).filter(Number.isFinite) : null,
      invalidation:Number.isFinite(Number(raw.invalidation)) ? Number(raw.invalidation) : null,
      confidence:clampNumber(Number(raw.confidence) || 0, 0, 100),
      reasonCodes:Array.isArray(raw.reasonCodes) ? raw.reasonCodes.map(String).slice(0, 8) : []
    };
  }

  async function requestOllamaAiDecision(decision){
    if(!settings.aiEnabled || !decision) return;
    const signature = decisionSignature(decision);
    if(aiDecisionCache[signature] || aiDecisionInFlight[signature]) return;
    aiDecisionInFlight[signature] = true;
    const facts = buildAiDecisionFacts(decision);
    const prompt = [
      'You are GoldPilot AI decision engine. You are not a chat assistant.',
      'Use only the JSON facts. Do not invent prices. Return strict JSON only.',
      'Your job: detect early opportunity, late entry risk, trap risk, and final trade decision.',
      'Never approve if trade is late, directly into liquidity, below master threshold, or risk is invalid.',
      'APPROVE only when facts support entry now. Otherwise WAIT, BLOCK, or LATE.',
      JSON.stringify(facts)
    ].join('\\n');
    try{
      const res = await fetch(settings.aiEndpoint, {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({
          model:settings.aiModel,
          stream:false,
          format:'json',
          messages:[
            {role:'system', content:'Return strict JSON only. No markdown. No extra text.'},
            {role:'user', content:prompt}
          ]
        })
      });
      if(!res.ok) throw new Error(`Ollama ${res.status}`);
      const data = await res.json();
      const rawText = data && data.message ? data.message.content : data.response || '';
      const parsed = normalizeAiDecision(extractJsonObject(rawText));
      if(parsed){
        aiDecisionCache[signature] = parsed;
        if(lastDecision && decisionSignature(lastDecision) === signature){
          lastDecision.aiDecision = parsed;
          renderDashboard(lastDecision);
        }
      }
    } catch(err){
      aiDecisionCache[signature] = {
        finalDecision:'WAIT',
        bestDirection:'WAIT',
        longProbability:0,
        shortProbability:0,
        waitProbability:100,
        entryTiming:'NO_TRADE',
        isLate:false,
        nextTrigger:`Ollama unavailable: ${err.message}`,
        entryZone:null,
        invalidation:null,
        confidence:0,
        reasonCodes:['ollama_unavailable']
      };
      console.warn('Ollama AI decision failed', err);
    } finally {
      delete aiDecisionInFlight[signature];
    }
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
      decision.earlyTrigger ? decision.earlyTrigger.score || 0 : 0,
      candidate ? candidate.entryReadinessScore || 0 : 0,
      decision.longSetup ? decision.longSetup.entryReadinessScore || 0 : 0,
      decision.shortSetup ? decision.shortSetup.entryReadinessScore || 0 : 0
    );
  }

  function displayTradePlan(decision){
    const candidate = bestSetupCandidate(decision);
    const plan = decision.tradePlan || (candidate && candidate.tradePlan) || null;
    return isTradePlanPriceCompatible(plan) ? plan : null;
  }

  function displayActionableTradePlan(decision){
    const plan = decision && decision.tradePlan ? decision.tradePlan : null;
    if(!isTradePlanPriceCompatible(plan)) return null;
    const final = decision && decision.finalTradeDecision ? decision.finalTradeDecision : resolveFinalTradeDecision(decision);
    if(decision.tradeStatus && decision.tradeStatus.includes('COMMITTED')) return plan;
    if(final && ['COMMIT','WAIT_FOR_ENTRY'].includes(final.finalAction)) return plan;
    if(decision.tradeStatus === 'ENTRY READY' && final && final.finalAction !== 'WAIT_FOR_OLLAMA') return plan;
    return null;
  }

  function displayFormationPlan(decision){
    const formation = decision && decision.formationPlan ? decision.formationPlan : null;
    if(!formation) return null;
    const zone = Array.isArray(formation.earlyEntryZone) ? formation.earlyEntryZone : [];
    const reference = planPriceReference();
    if(reference != null && zone.length){
      const center = zone.map(Number).filter(Number.isFinite).reduce((sum, value) => sum + value, 0) / zone.length;
      if(!isFinite(center) || center <= 0) return null;
      const ratio = center / reference;
      if(ratio < 0.25 || ratio > 4) return null;
    }
    if(reference != null && formation.invalidation != null){
      const invalidation = Number(formation.invalidation);
      if(!isFinite(invalidation) || invalidation <= 0) return null;
      const ratio = invalidation / reference;
      if(ratio < 0.25 || ratio > 4) return null;
    }
    return formation;
  }

  function displaySetup(decision){
    const candidate = bestSetupCandidate(decision);
    if(decision.earlyTrigger && decision.earlyTrigger.ready){
      return {
        setup:'Early liquidity trigger',
        direction:decision.earlyTrigger.side,
        quality:decision.signalGrade ? decision.signalGrade.grade : 'B+',
        reasons:decision.earlyTrigger.reasons || []
      };
    }
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
      tp3: plan.takeProfit ? plan.takeProfit.tp3 : null,
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

  function normalizeYahooChart(result, aggregate=1){
    const chart = result && result.chart && result.chart.result && result.chart.result[0];
    if(!chart || !chart.timestamp || !chart.indicators || !chart.indicators.quote) throw new Error('Yahoo chart returned no candles');
    const quote = chart.indicators.quote[0] || {};
    const timestamps = chart.timestamp || [];
    const rows = timestamps.map((ts, i) => ({
      t: ts * 1000,
      o: Number(quote.open && quote.open[i]),
      h: Number(quote.high && quote.high[i]),
      l: Number(quote.low && quote.low[i]),
      c: Number(quote.close && quote.close[i]),
      v: Number(quote.volume && quote.volume[i] || 0),
      x: ts * 1000,
      isClosed:true
    })).filter(c => [c.o,c.h,c.l,c.c].every(Number.isFinite));
    if(aggregate <= 1) return rows;
    const grouped = [];
    for(let i=0;i<rows.length;i+=aggregate){
      const chunk = rows.slice(i, i + aggregate);
      if(chunk.length < aggregate) continue;
      grouped.push({
        t:chunk[0].t,
        o:chunk[0].o,
        h:Math.max(...chunk.map(c => c.h)),
        l:Math.min(...chunk.map(c => c.l)),
        c:chunk[chunk.length - 1].c,
        v:chunk.reduce((sum, c) => sum + (c.v || 0), 0),
        x:chunk[chunk.length - 1].x,
        isClosed:true
      });
    }
    return grouped;
  }

  async function fetchBinanceKlines(interval, limit=CONFIG.candlesLimit, symbol=CONFIG.symbol){
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

  async function fetchYahooKlines(interval, limit=CONFIG.candlesLimit, symbol=CONFIG.symbol){
    const profile = profileForSymbol(symbol);
    const cfg = YAHOO_INTERVALS[interval] || YAHOO_INTERVALS['15m'];
    const yahooSymbol = encodeURIComponent(profile.yahooSymbol || symbol);
    const path = `/v8/finance/chart/${yahooSymbol}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;
    let lastError = null;
    if(marketApiEnabled()){
      try{
        const data = await marketApi(`/api/market-candles?symbol=${encodeURIComponent(profile.yahooSymbol || symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`);
        const rows = data && Array.isArray(data.candles) ? data.candles : [];
        if(rows.length){
          marketDataSourceMode = data.source === 'cache' ? 'cache' : 'worker';
          return rows.slice(-limit);
        }
      } catch(err){
        lastError = err;
      }
    }
    const urls = [
      `https://query1.finance.yahoo.com${path}`,
      `https://query2.finance.yahoo.com${path}`
    ];
    if(shouldTryDirectYahoo()){
      for(const url of urls){
        try{
          const rows = normalizeYahooChart(await fetchJson(url), cfg.aggregate || 1);
          if(rows.length) return rows.slice(-limit);
        } catch(err){
          lastError = err;
        }
      }
    }
    const cacheAllowed = CONFIG.allowIndianCacheFallback === true || localStorage.getItem('goldpilotAllowCachedIndianData') === 'true';
    const cachedRows = cacheAllowed ? cachedIndianKlines(profile.yahooSymbol || symbol, interval, limit) : [];
    if(cachedRows.length){
      marketDataSourceMode = 'cache';
      return cachedRows;
    }
    throw lastError || new Error(`${profile.displayName || symbol} Yahoo candles unavailable`);
  }

  function cachedIndianKlines(symbol, interval, limit){
    const cache = window.GOLDPILOT_INDIAN_MARKET_CACHE;
    const normalized = normalizeMarketSymbol(symbol);
    const symbolCache = cache && cache.symbols && cache.symbols[normalized];
    if(!symbolCache) return [];
    const fallbackOrder = interval === '1m'
      ? ['1m', '5m', '15m', '1h', '1d']
      : [interval, '15m', '5m', '1h', '1d'];
    for(const key of fallbackOrder){
      const rows = Array.isArray(symbolCache[key]) ? symbolCache[key] : [];
      if(rows.length >= 5){
        return rows.slice(-limit).map(row => Object.assign({}, row, {isClosed:row.isClosed !== false, cached:true}));
      }
    }
    return [];
  }

  async function fetchKlines(interval, limit=CONFIG.candlesLimit, symbol=CONFIG.symbol){
    const profile = profileForSymbol(symbol);
    if(profile.dataSource === 'yahoo') return fetchYahooKlines(interval, limit, symbol);
    return fetchBinanceKlines(interval, limit, symbol);
  }

  function confirmedCandles(candles){
    return (candles || []).filter(c => c && c.isClosed !== false);
  }

  async function fetchBinanceTicker(){
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

  async function fetchYahooTicker(){
    const profile = profileForSymbol(CONFIG.symbol);
    const rows = await fetchYahooKlines('1d', 5, CONFIG.symbol);
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if(!last) throw new Error(`${profile.displayName} ticker unavailable`);
    const changePct = prev && prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0;
    return {
      last:last.c,
      changePct,
      volume:last.v || 0,
      bid:last.c,
      ask:last.c,
      spread:0
    };
  }

  async function fetchTicker(){
    const profile = profileForSymbol(CONFIG.symbol);
    if(profile.dataSource === 'yahoo') return fetchYahooTicker();
    return fetchBinanceTicker();
  }

  function tickerFromCandles(candles){
    const rows = confirmedCandles(candles || []);
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if(!last) return null;
    return {
      last:last.c,
      changePct:prev && prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0,
      volume:last.v || 0,
      bid:last.c,
      ask:last.c,
      spread:0
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
    const profile = profileForSymbol(CONFIG.symbol);
    const indiaTerms = profile.marketType === 'indian_index'
      ? ' OR nifty OR "bank nifty" OR sensex OR nse OR bse OR "reserve bank of india" OR rbi OR "india cpi"'
      : '';
    const query = encodeURIComponent(`("gold price" OR "spot gold" OR "gold futures" OR xauusd OR bitcoin OR ethereum OR crypto OR binance OR "federal reserve" OR "us dollar" OR "treasury yields" OR inflation OR cpi OR fomc${indiaTerms})`);
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
      symbol: CONFIG.symbol,
      newsEvents: loadManualNewsEvents()
    });
  }

  async function refreshMarketData(){
    setConnection('CONNECTING', 'var(--amber)');
    marketDataSourceMode = 'live';
    const profile = profileForSymbol(CONFIG.symbol);
    const timeframeResults = await Promise.allSettled(TIMEFRAMES.map(async ([label, interval]) => {
      const rows = await fetchKlines(interval);
      return [label, rows];
    }));
    const loadErrors = [];
    timeframeResults.forEach((result, i) => {
      const label = TIMEFRAMES[i][0];
      if(result.status === 'fulfilled'){
        candlesByTimeframe[result.value[0]] = result.value[1];
      } else {
        loadErrors.push(`${label}: ${result.reason && result.reason.message ? result.reason.message : result.reason}`);
      }
    });
    const hasPrimaryCandles = confirmedCandles(candlesByTimeframe[activeTimeframe] || candlesByTimeframe['15M'] || []).length >= 5;
    if(!hasPrimaryCandles){
      throw new Error(loadErrors[0] || `${CONFIG.symbol} market candles unavailable`);
    }
    await Promise.all([
      profile.dataSource === 'yahoo'
        ? Promise.resolve()
        : fetchTicker().then(t => { latestTicker = t; }),
      refreshLiveNews().catch(err => {
        console.warn('live news unavailable', err);
        newsSourceStatus = liveNewsEvents.length ? 'Cached' : 'Manual';
      })
    ]);
    if(profile.dataSource === 'yahoo'){
      latestTicker = tickerFromCandles(candlesByTimeframe['15M']) || tickerFromCandles(candlesByTimeframe['D']);
    }
    await updateDemoTrades();
    const decision = buildDecision();
    renderDashboard(decision);
    const connectionText = marketDataSourceMode === 'cache' ? 'CACHED DATA' : loadErrors.length ? 'PARTIAL DATA' : 'LIVE';
    const connectionColor = marketDataSourceMode === 'cache' || loadErrors.length ? 'var(--amber)' : 'var(--green)';
    setConnection(connectionText, connectionColor);
    if(loadErrors.length) console.warn(`${CONFIG.symbol} partial market data`, loadErrors);
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
    const next = normalizeMarketSymbol(symbol || CONFIG.symbol);
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
    renderSymbolLoading(next);
    refreshMarketData().catch(err => {
      console.error(err);
      setConnection('DATA ERROR', 'var(--red)');
      setHtml('#status-reason', `<b>Data error.</b> ${escapeHtml(marketDataErrorHint(next, err))}`);
    });
  }

  function ensurePrimarySymbolOption(symbol){
    const picker = qs('#primary-symbol');
    if(!picker || Array.from(picker.options).some(opt => opt.value === symbol)) return;
    const option = document.createElement('option');
    option.value = symbol;
    option.textContent = displayNameForSymbol(symbol);
    picker.appendChild(option);
  }

  async function scanWatchlist(){
    const symbols = loadWatchlistSymbols();
    const results = await Promise.allSettled(symbols.map(scanWatchSymbol));
    const failed = [];
    const rows = results.map((result, i) => {
      if(result.status === 'fulfilled') return result.value;
      failed.push(`${symbols[i]}: ${result.reason && result.reason.message ? result.reason.message : result.reason}`);
      return null;
    });
    if(failed.length) console.warn('watchlist partial data', failed);
    watchlistRows = rows.filter(Boolean).sort((a,b) => b.score - a.score);
    renderWatchlist();
    notifyConfirmedTrades(watchlistRows);
  }

  function loadWatchlistSymbols(){
    try{
      const saved = JSON.parse(localStorage.getItem('goldpilotWatchlistSymbols') || '[]');
      if(Array.isArray(saved) && saved.length) return saved.map(normalizeMarketSymbol).filter(Boolean);
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
        symbol,
        newsEvents:loadManualNewsEvents()
      });
      const preferredCandidate = decision.preferredDirection === 'LONG'
        ? decision.longSetup
        : decision.preferredDirection === 'SHORT'
          ? decision.shortSetup
          : null;
      const rawPlan = decision.tradePlan || (preferredCandidate && preferredCandidate.tradePlan) || null;
      const referencePrice = confirmedM15.length ? confirmedM15[confirmedM15.length - 1].c : null;
      const plan = isTradePlanPriceCompatible(rawPlan, referencePrice) ? rawPlan : null;
      const setup = decision.setup && decision.setup.setup
        ? decision.setup.setup
        : decision.earlyTrigger && decision.earlyTrigger.ready
          ? 'Early liquidity trigger'
        : preferredCandidate && preferredCandidate.setup
          ? preferredCandidate.setup
          : decision.regime.regime;
      const monitorScore = Math.max(
        decision.entryReadinessScore || 0,
        decision.earlyTrigger ? decision.earlyTrigger.score || 0 : 0,
        decision.longSetup ? decision.longSetup.entryReadinessScore || 0 : 0,
        decision.shortSetup ? decision.shortSetup.entryReadinessScore || 0 : 0,
        decision.preferredDirection === 'NONE' && decision.nextStepForecast ? Math.min(45, decision.nextStepForecast.confidence || 0) : 0
      );
      const marketChangePct = candleChangePct(confirmedD1) ?? candleChangePct(confirmedM15);
      return {
        symbol,
        status:decision.tradeStatus,
        stage:decision.setupStage,
        score:monitorScore,
        marketChangePct,
        bias:decision.bias ? decision.bias.bias : '-',
        setup,
        side:plan ? plan.side : decision.preferredDirection,
        entry:plan ? plan.entry : null,
        stopLoss:plan ? plan.stopLoss : null,
        tp1:plan && plan.takeProfit ? plan.takeProfit.tp1 : null,
        riskReward:plan ? plan.riskReward : null,
        grade:decision.signalGrade ? decision.signalGrade.grade : '-',
        committable:decision.signalGrade ? decision.signalGrade.committable : false,
        brain:decision.marketBrain || null,
        plan,
        risk:decision.risk,
        setupObj:decision.setup,
        scannedAt:Date.now(),
        ready:isCommittableDecision(decision),
        blocked:decision.tradeStatus === 'BLOCKED',
        reason:[...(decision.missingConditions || []), ...(decision.nextConditionNeeded || []), ...(decision.reason || [])].slice(0,2).join(' ')
      };
    } catch(err){
      return {symbol, status:'DATA ERROR', stage:'ERROR', score:0, marketChangePct:null, bias:'-', setup:err.message, ready:false, blocked:true};
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

  function renderSymbolLoading(symbol){
    const profile = profileForSymbol(symbol);
    setText('#live-price', '-');
    setText('#live-chg', 'Loading market data');
    const label = qs('.price-display div');
    if(label) label.textContent = profile.displayName || symbol;
    setHtml('#status-reason', `<b>Loading ${escapeHtml(profile.indexName || profile.displayName || symbol)}.</b> Fetching ${escapeHtml(profile.dataSource === 'yahoo' ? 'Yahoo index' : profile.dataSource)} candles.`);
    clearChart();
    clearEntryCard();
    renderMarketBrain({marketBrain:{
      action:'WAIT',
      finalDecision:'Loading',
      playbook:'-',
      confidence:0,
      situation:'Waiting for fresh symbol data.',
      nextTrigger:'Load candles before making a decision.',
      warnings:['Old chart cleared while new data loads.']
    }});
  }

  function clearChart(){
    const svg = qs('svg.chart g#candles');
    const axis = qs('#price-axis');
    const marker = qs('#current-price-marker');
    if(svg) svg.innerHTML = '';
    if(axis) axis.innerHTML = '';
    if(marker) marker.innerHTML = '';
    chartScale = null;
  }

  function clearEntryCard(){
    const card = qs('#signal-card');
    if(!card) return;
    const type = card.querySelector('.signal-type');
    const hint = card.querySelector('.signal-hint');
    const zone = card.querySelector('.zone-price');
    const rr = card.querySelector('.rr-value');
    const rrFill = card.querySelector('.rr-fill');
    const values = card.querySelectorAll('.mini-value');
    if(type) type.textContent = 'WAIT - Loading data';
    if(hint) hint.textContent = 'Fresh candles are required before showing entry, TP, or invalidation.';
    if(zone) zone.textContent = '-';
    values.forEach(v => { v.textContent = '-'; });
    if(rr) rr.textContent = '-';
    if(rrFill) rrFill.style.width = '0%';
  }

  function renderDashboard(decision){
    const signature = decisionSignature(decision);
    if(settings.aiEnabled && aiDecisionCache[signature]) decision.aiDecision = aiDecisionCache[signature];
    decision.finalTradeDecision = resolveFinalTradeDecision(decision);
    const freshCommit = commitDecision(decision);
    const activeCommit = freshCommit || loadActiveCommittedSignal();
    decision = applyCommittedSignal(decision, activeCommit);
    if(settings.aiEnabled && aiDecisionCache[signature]) decision.aiDecision = aiDecisionCache[signature];
    decision.finalTradeDecision = resolveFinalTradeDecision(decision);
    if(settings.aiEnabled) requestOllamaAiDecision(decision);
    lastDecision = decision;
    renderHero(decision);
    renderMarketBrain(decision);
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
    saveGeneratedStrategy(decision);
    appendJournalSnapshot(decision, 'auto');
    populateTradeSignalSelect();
    renderTradeJournal();
    updateDemoTrades()
      .then(() => {
        renderDemoTrades();
        if(lastDecision) renderRisk(lastDecision);
      })
      .catch(err => console.warn('demo trade update failed', err));
  }

  function renderDecisionState(decision){
    const finalTrade = decision.finalTradeDecision || resolveFinalTradeDecision(decision);
    const score = displayReadinessScore(decision);
    const badge = qs('#status-badge');
    if(badge && finalTrade && finalTrade.allowCommit) badge.classList.add('allowed');
    const setupEl = qsa('.status-row > div')[1];
    if(setupEl){
      const lines = setupEl.querySelectorAll('div');
      if(lines[1]){
        const grade = decision.signalGrade ? ` | grade ${decision.signalGrade.grade}` : '';
        const master = decision.masterScore ? ` | master ${decision.masterScore.score} ${decision.masterScore.tier}` : '';
        lines[1].textContent = `${decision.setupStage || 'WAIT'} | evidence ${score}/100${grade}${master}`;
      }
    }
  }

  function renderHero(decision){
    const finalTrade = decision.finalTradeDecision || resolveFinalTradeDecision(decision);
    const badge = qs('#status-badge');
    if(badge){
      badge.className = 'status-badge';
      if(finalTrade && ['BLOCK','LATE'].includes(finalTrade.finalAction)) badge.classList.add('blocked');
      else if(finalTrade && ['COMMIT','MANAGE'].includes(finalTrade.finalAction)) badge.classList.add('allowed');
      else badge.classList.add('wait');
      badge.textContent = finalTrade ? finalTrade.label : decision.tradeStatus;
    }

    const setup = displaySetup(decision);
    const score = displayReadinessScore(decision);
    const setupText = setup && setup.setup
      ? `${setup.setup} (${setup.quality || 'Watch'}) | setup ${score}/100${decision.masterScore ? ` | engine ${decision.masterScore.score}/100 ${decision.masterScore.tier}` : ''}`
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
    const advisor = decision.aiAdvisor;
    if(advisor){
      const ai = decision.aiDecision;
      const aiLine = ai
        ? `<b>Ollama Brain:</b> ${escapeHtml(ai.finalDecision)} ${escapeHtml(ai.bestDirection)} | confidence ${fmt(ai.confidence,0)}% | L ${fmt(ai.longProbability,0)} / S ${fmt(ai.shortProbability,0)} / W ${fmt(ai.waitProbability,0)} | ${escapeHtml(ai.entryTiming)}`
        : settings.aiEnabled
          ? `<b>Ollama Brain:</b> Waiting for structured decision...`
          : '';
      const advisorHtml = [
        aiLine || `<b>GoldPilot Engine Read:</b> ${escapeHtml(advisor.summary)}`,
        finalTrade ? `<br><span style="color:var(--text2)">Final:</span> ${escapeHtml(finalTrade.label)}. ${escapeHtml(finalTrade.reason || '')}` : '',
        aiLine ? `<br><span style="color:var(--text2)">Engine evidence:</span> ${escapeHtml(advisor.primaryIdea)}.` : `<br><span style="color:var(--text2)">Primary:</span> ${escapeHtml(advisor.primaryIdea)}.`,
        `<br><span style="color:var(--text2)">Next:</span> ${escapeHtml(ai && ai.nextTrigger ? ai.nextTrigger : (advisor.nextBestActions || [])[0] || 'Wait for a cleaner confirming candle.')}`,
        advisor.mistakeWarning && advisor.mistakeWarning.length
          ? `<br><span style="color:var(--red)">Warning:</span> ${escapeHtml(advisor.mistakeWarning[0])}`
          : '',
        advisor.oppositeScenario
          ? `<br><span style="color:var(--text2)">Other side:</span> ${escapeHtml(advisor.oppositeScenario)}`
          : ''
      ].join('');
      setHtml('#status-reason', advisorHtml);
    } else {
      setHtml('#status-reason', reasons.length
        ? `<b>${decision.tradeStatus}.</b> ${reasons.map(escapeHtml).join(' ')}`
        : '<b>WAIT.</b> No engine reason returned yet.');
    }
  }

  function renderMarketBrain(decision){
    const brain = decision.marketBrain || {};
    const finalTrade = decision.finalTradeDecision || resolveFinalTradeDecision(decision);
    const ai = decision.aiDecision || null;
    const aiReasons = ai && Array.isArray(ai.reasonCodes) ? ai.reasonCodes : [];
    const aiMain = settings.aiEnabled && ai && !aiReasons.includes('ollama_unavailable');
    const action = qs('#brain-action');
    const final = qs('#brain-final');
    const playbook = qs('#brain-playbook');
    const source = qs('#brain-source');
    const confidence = qs('#brain-confidence');
    const fill = qs('#brain-confidence-fill');
    const situation = qs('#brain-situation');
    const discipline = qs('#brain-discipline');
    const past = qs('#brain-past');
    const library = qs('#brain-library');
    const next = qs('#brain-next');
    const warning = qs('#brain-warning');
    const actionText = finalTrade ? finalTrade.label : aiMain ? ai.finalDecision : brain.action || 'WAIT';
    const actionColor = /APPROVE|DEMO_READY|COMMIT|COMMITTED|MANAGE/.test(actionText) ? 'var(--green)'
      : /BLOCK|LATE/.test(actionText) ? 'var(--red)'
        : /ALERT/.test(actionText) ? 'var(--gold-light)' : 'var(--cyan)';
    if(action){
      action.textContent = actionText.replace('_', ' ');
      action.style.color = actionColor;
      action.style.borderColor = actionColor;
    }
    if(source) source.textContent = finalTrade ? `Final: ${finalTrade.source} | ${finalTrade.decisionMode}` : aiMain ? `Ollama main brain | ${ai.entryTiming}` : settings.aiEnabled ? 'Ollama pending | engine evidence shown' : 'Engine brain | Ollama off';
    if(final) final.textContent = finalTrade ? `${finalTrade.label} | ${finalTrade.direction || 'WAIT'}` : aiMain ? `Ollama says ${ai.finalDecision} ${ai.bestDirection}` : brain.finalDecision || 'Wait';
    const generated = brain.generatedStrategy || brain.adaptive && brain.adaptive.generatedStrategy || null;
    if(playbook) playbook.textContent = generated ? `Generated strategy: ${generated.name}` : aiMain ? `Main decision: ${ai.nextTrigger}` : `${brain.playbook || 'No playbook'} | ${brain.autonomy || 'Observation mode'}`;
    const mainConfidence = finalTrade && finalTrade.confidence != null ? finalTrade.confidence : aiMain ? ai.confidence : brain.confidence || 0;
    if(confidence) confidence.textContent = aiMain && finalTrade && finalTrade.source === 'OLLAMA' ? `Ollama confidence ${fmt(mainConfidence, 0)}%` : `Final confidence ${fmt(mainConfidence, 0)}/100`;
    if(fill) fill.style.width = `${Math.max(0, Math.min(100, Number(mainConfidence || 0)))}%`;
    const probGrid = qs('#ai-prob-grid');
    if(probGrid) probGrid.style.display = aiMain ? 'grid' : 'none';
    setText('#ai-prob-long', aiMain ? `${fmt(ai.longProbability, 0)}%` : '0%');
    setText('#ai-prob-short', aiMain ? `${fmt(ai.shortProbability, 0)}%` : '0%');
    setText('#ai-prob-wait', aiMain ? `${fmt(ai.waitProbability, 0)}%` : '0%');
    if(situation) situation.textContent = brain.situation ? `${brain.situation.label} | ${(brain.situation.reasons || [])[0] || 'No dominant situation reason'}` : '-';
    if(discipline){
      const philosophy = brain.philosophy || {};
      const execution = brain.executionQuality || {};
      discipline.textContent = `${execution.label || 'WAIT'} ${fmt(execution.score || 0, 0)}/100 | ${philosophy.summary || 'No discipline warning'}`;
    }
    if(past) past.textContent = brain.marketState || '-';
    if(library){
      const rankings = brain.playbookRankings || [];
      const adaptive = brain.adaptive && Array.isArray(brain.adaptive.libraryUsed) ? brain.adaptive.libraryUsed : [];
      const hybrid = generated ? generated.name : brain.adaptive && brain.adaptive.bestHybrid ? brain.adaptive.bestHybrid.name : null;
      const mode = brain.decisionMode || (brain.adaptive && brain.adaptive.decisionMode);
      library.textContent = hybrid
        ? `${hybrid} | ${mode || 'HYBRID'}`
        : adaptive.length
        ? adaptive.slice(0, 3).join(' | ')
        : rankings.length
        ? rankings.slice(0, 3).map(p => `${p.name} ${fmt(p.score, 0)}`).join(' | ')
        : brain.playbook || '-';
    }
    if(next) next.textContent = finalTrade && finalTrade.reason ? finalTrade.reason : aiMain ? ai.nextTrigger : brain.nextTrigger || '-';
    if(warning) warning.textContent = finalTrade && finalTrade.finalAction === 'WAIT_FOR_ENTRY' ? 'Valid strategy, but price is outside the entry zone.' : aiMain && aiReasons.length ? aiReasons.join(', ') : brain.warnings && brain.warnings.length ? brain.warnings[0] : (brain.evidence && brain.evidence[0]) || 'No major warning';
  }

  function renderChart(candles){
    const svg = qs('svg.chart g#candles');
    if(!svg) return;
    if(!candles.length){
      clearChart();
      const chartTitle = qs('.chart-header > span');
      if(chartTitle) chartTitle.textContent = `Price Action - ${activeTimeframe}`;
      return;
    }
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
    const card = qs('#signal-card');
    if(!card) return;
    const finalTrade = decision.finalTradeDecision || resolveFinalTradeDecision(decision);
    const plan = displayActionableTradePlan(decision);
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
    const side = plan ? plan.side : finalTrade && finalTrade.direction ? finalTrade.direction : 'WAIT';
    const planHasValidReward = !!(plan && plan.riskReward >= 2);
    renderDirectionalSetups(decision);
    if(type){
      const prefix = decision.tradeStatus.includes('COMMITTED') ? 'COMMITTED ' : '';
      type.textContent = finalTrade && !plan && finalTrade.finalAction !== 'COMMIT'
        ? finalTrade.label
        : plan && setup && setup.setup
        ? `${prefix}${side} - ${setup.setup}`
        : `${decision.preferredDirection || 'NONE'} - ${setup && setup.setup ? setup.setup : 'No valid signal'}`;
      type.style.color = side === 'SHORT' ? 'var(--red)' : side === 'LONG' ? 'var(--green)' : 'var(--amber)';
    }
    if(icon){
      icon.className = side === 'SHORT' ? 'ti ti-arrow-down' : side === 'LONG' ? 'ti ti-arrow-up' : 'ti ti-clock';
      icon.style.color = side === 'SHORT' ? 'var(--red)' : side === 'LONG' ? 'var(--green)' : 'var(--amber)';
    }
    if(time) time.textContent = decision.tradeStatus.includes('COMMITTED') ? 'Committed' : finalTrade ? finalTrade.label : 'Forming';
    if(clear) clear.style.display = decision.tradeStatus.includes('COMMITTED') ? 'inline-flex' : 'none';
    if(hint){
      if(finalTrade && finalTrade.finalAction !== 'COMMIT'){
        hint.textContent = `${finalTrade.label}: ${finalTrade.reason || 'Waiting for a cleaner synchronized decision.'}`;
      } else if(decision.aiDecision){
        const ai = decision.aiDecision;
        const aiVerdict = `AI ${ai.finalDecision} ${ai.bestDirection} (${fmt(ai.confidence, 0)}%): ${ai.nextTrigger}`;
        if(decision.aiAdvisor){
          hint.textContent = `${decision.aiAdvisor.primaryIdea}. ${aiVerdict} ${decision.aiAdvisor.mistakeWarning && decision.aiAdvisor.mistakeWarning[0] ? `Warning: ${decision.aiAdvisor.mistakeWarning[0]}` : ''}`;
        } else {
          hint.textContent = aiVerdict;
        }
      } else if(decision.aiAdvisor){
        hint.textContent = `${decision.aiAdvisor.primaryIdea}. ${((decision.aiAdvisor.nextBestActions || [])[0] || decision.aiAdvisor.summary)} ${decision.aiAdvisor.mistakeWarning && decision.aiAdvisor.mistakeWarning[0] ? `Warning: ${decision.aiAdvisor.mistakeWarning[0]}` : ''}`;
      } else {
        const forecast = decision.nextStepForecast;
        const targetNote = plan && plan.targetQuality ? ` Target quality: ${plan.targetQuality}. ${plan.targetWarning || ''}` : '';
        const formation = displayFormationPlan(decision);
        const early = decision.earlyTrigger;
        hint.textContent = early && early.active
          ? `${early.stage}: ${early.reasons.slice(0, 3).join('. ')}. ${formation && formation.tooLateRule ? formation.tooLateRule : ''}`
          : formation && formation.side
          ? `${formation.phase}: ${formation.context}. Trigger: ${formation.trigger}. ${formation.tooLateRule || ''}`
          : forecast
            ? `${forecast.expectation}. ${forecast.nextCandleMust}`
            : (decision.nextConditionNeeded || decision.reason || ['Wait for confirmed setup.']).join(' ');
        hint.textContent += targetNote;
      }
    }
    const formation = displayFormationPlan(decision);
    if(zone){
      if(plan && plan.entryZone){
        zone.textContent = planHasValidReward ? `${fmtPrice(plan.entryZone[0])} - ${fmtPrice(plan.entryZone[1])}` : 'NO ENTRY - TARGET TOO CLOSE';
      } else if(formation && formation.earlyEntryZone){
        zone.textContent = `${fmtPrice(formation.earlyEntryZone[0])} - ${fmtPrice(formation.earlyEntryZone[1])}`;
      } else {
        zone.textContent = '-';
      }
    }
    if(values[0]) values[0].textContent = plan && plan.takeProfit ? (planHasValidReward ? fmtPrice(plan.takeProfit.tp1) : `Wait (${fmtPrice(plan.takeProfit.tp1)})`) : '-';
    if(values[1]) values[1].textContent = plan ? fmtPrice(plan.invalidation) : formation && formation.invalidation ? fmtPrice(formation.invalidation) : '-';
    if(values[2]) values[2].textContent = plan && plan.takeProfit ? (planHasValidReward ? fmtPrice(plan.takeProfit.tp2) : `Wait (${fmtPrice(plan.takeProfit.tp2)})`) : '-';
    if(values[3]) values[3].textContent = plan ? fmtPrice(plan.stopLoss) : formation && formation.invalidation ? fmtPrice(formation.invalidation) : '-';
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
    if(rows[0]) rows[0].textContent = `$${fmt(settings.balance, 2)}`;
    if(rows[1]) rows[1].textContent = `${risk.riskPct || settings.riskPct}% - $${fmt(risk.maxLoss || settings.balance * settings.riskPct / 100, 2)}`;
    if(rows[2]) rows[2].textContent = risk.slDistance ? `${fmtPrice(risk.slDistance)} price units` : '-';
    if(rows[3]) rows[3].textContent = risk.lotSize == null ? '-' : `${fmt(risk.lotSize, 2)} qty`;
    if(rows[4]) rows[4].textContent = `${fmt(stats.dailyLossPct, 2)} / ${fmt(settings.maxDailyLossPct, 1)}%`;
    if(rows[5]) rows[5].textContent = `${stats.tradesToday} / ${settings.maxTradesPerDay}`;
    const status = qs('#risk-panel')?.querySelector('div[style*="font-size:12px"]');
    if(status){
      const profile = profileForSymbol(CONFIG.symbol);
      status.textContent = risk.allowed
        ? `Permitted by ${profile.marketType === 'indian_index' ? 'Indian index point-quantity' : 'Binance spot quantity'} risk engine`
        : (risk.reasons || ['No actionable trade plan'])[0];
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
      {ok: !crypto || !crypto.chaseRisk, label: crypto && crypto.isCrypto ? 'Crypto chase/liquidation risk' : crypto && crypto.isIndianIndex ? 'India index opening/expiry risk clear' : 'Market-specific risk clear'},
      {ok: !!(setup && setup.direction), label: setup && setup.setup ? setup.setup : 'Valid setup detected'},
      {ok: decision.preferredDirection !== 'NONE', label: `Preferred direction: ${decision.preferredDirection || 'NONE'}`},
      {ok: !!decision.nextStepForecast, label: decision.nextStepForecast ? `Next-step evidence: ${decision.nextStepForecast.leadDirection} ${decision.nextStepForecast.confidence}/100` : 'Next-step evidence'},
      {ok: !missing.some(m => /BOS|CHOCH/i.test(m)), label: 'BOS/CHOCH confirmation'},
      {ok: decision.entryTrigger.ready, label: `Entry trigger evidence (${displayReadinessScore(decision)}/100)`},
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
      const moveText = row.marketChangePct == null ? 'Move -' : `Move ${pct(row.marketChangePct)}`;
      const detail = row.entry
        ? `${moveText} | ${row.grade || '-'} ${row.side || ''} entry ${fmtPrice(row.entry)} | SL ${fmtPrice(row.stopLoss)} | TP1 ${fmtPrice(row.tp1)} | R:R ${row.riskReward ? `1:${fmt(row.riskReward,2)}` : '-'}`
        : `${moveText} | ${row.bias} | ${row.setup || row.reason || row.stage}`;
      const age = row.scannedAt ? `scan ${formatAge(row.scannedAt)} ago` : 'scan age -';
      return `<div class="watchlist-row" data-symbol="${escapeHtml(row.symbol)}" title="Open ${escapeHtml(row.symbol)} chart">
        <div class="watch-symbol">${escapeHtml(row.symbol.replace('USDT',''))}</div>
        <div class="watch-status">${escapeHtml(row.status)}<br>${escapeHtml(detail)}<br><span style="font-size:10px;color:var(--text3);font-family:'DM Mono',monospace">${escapeHtml(age)}</span></div>
        <div class="watch-score ${scoreClass}"><span style="display:block;font-size:9px;color:var(--text3)">Scan</span>${row.score}/100</div>
      </div>`;
    }).join('');
    const alerts = rows.filter(r => r.ready);
    const alertBox = qs('#watchlist-alerts');
    if(alertBox){
      alertBox.innerHTML = alerts.length
        ? `<b>${alerts.length} confirmed setup${alerts.length > 1 ? 's' : ''}:</b>${alerts.map(a =>
            `<button type="button" data-symbol="${escapeHtml(a.symbol)}">${escapeHtml(a.symbol)} ${escapeHtml(a.grade || '')} ${escapeHtml(a.side || '')} entry ${fmtPrice(a.entry)} | SL ${fmtPrice(a.stopLoss)} | TP1 ${fmtPrice(a.tp1)}</button>`
          ).join('')}<div style="margin-top:6px">${escapeHtml(watchlistCommitSummary(rows))}</div>`
        : `Scanning ${loadWatchlistSymbols().length} configured markets. No confirmed trade right now.<div style="margin-top:6px">${escapeHtml(watchlistCommitSummary(rows))}</div>`;
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
    return `Committed today: ${demoCommittedToday} | Active committed: ${activeCommitted} | Best forming: ${best.symbol}${side} scan ${best.score}/100 | ${blocker}`;
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
    if(statValues[2]) statValues[2].textContent = `${profileForSymbol(CONFIG.symbol).dataSource === 'yahoo' ? 'Yahoo' : 'Binance'} ${CONFIG.symbol}`;
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
      const openQty = row.openQuantity != null ? row.openQuantity : row.quantity;
      const settled = row.balanceSettled && row.balanceAfter != null
        ? ` | Balance $${fmt(row.balanceBefore, 2)} -> $${fmt(row.balanceAfter, 2)}`
        : '';
      const reserved = row.reservedRisk != null ? ` | Risk $${fmt(row.reservedRisk, 2)}` : '';
      const partial = row.tp1Settled ? ` | TP1 ${row.tpPartials && row.tpPartials.tp1 ? row.tpPartials.tp1 : 40}% banked` : '';
      const tp2Partial = row.tp2Settled ? ` | TP2 ${row.tpPartials && row.tpPartials.tp2 ? row.tpPartials.tp2 : 35}% banked` : '';
      return `<div class="demo-trade ${isClosed ? 'closed' : 'open'}">
        <div class="demo-head">
          <span class="demo-symbol">${escapeHtml(row.symbol)} ${escapeHtml(row.side || '')}</span>
          <span class="demo-status">${escapeHtml(result)}</span>
        </div>
        <div class="demo-line">${escapeHtml(row.timeframe || '-')} | Qty ${fmt(row.quantity || 0, 2)} / open ${fmt(openQty || 0, 2)} | Entry ${fmtPrice(row.entry)}</div>
        <div class="demo-line">SL ${fmtPrice(row.stopLoss)} | TP1 ${fmtPrice(row.tp1)} | TP2 ${fmtPrice(row.tp2)} | TP3 ${fmtPrice(row.tp3)}</div>
        <div class="demo-line demo-pnl ${pnlClass}">Demo PnL ${Number(row.pnl || 0) >= 0 ? '+' : ''}$${fmt(row.pnl || 0, 2)}${reserved}${partial}${tp2Partial}${settled}</div>
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

  const PAGE_META = {
    Dashboard: {
      heading:'Dashboard',
      subtitle:'Live decision cockpit with chart, signal, risk, and market context'
    },
    Analysis: {
      heading:'Analysis',
      subtitle:'Bias, regime, candle behavior, liquidity, news, and checklist quality'
    },
    Backtests: {
      heading:'Signals & Watchlist',
      subtitle:'Demo auto-trades, committed setups, and scanned market opportunities'
    },
    Journal: {
      heading:'Journal',
      subtitle:'Decision snapshots, reviewed trades, and daily risk history'
    },
    Settings: {
      heading:'Settings',
      subtitle:'Risk model, AI options, and current signal control'
    }
  };

  function setAppPage(pageName){
    const page = PAGE_META[pageName] ? pageName : 'Dashboard';
    document.body.dataset.page = page;
    qsa('.pill').forEach(p => p.classList.toggle('active', p.textContent.trim() === page));
    const heading = qs('#page-heading');
    const subtitle = qs('#page-subtitle');
    if(heading) heading.textContent = PAGE_META[page].heading;
    if(subtitle) subtitle.textContent = PAGE_META[page].subtitle;
    const anchor = page === 'Journal' ? qs('#journal-section') : qs('#dashboard-section');
    if(anchor && window.scrollY > 80) window.scrollTo({top:0, behavior:'smooth'});
  }

  function wireTabs(){
    if(!document.body.dataset.page) setAppPage('Dashboard');
    qsa('.pill').forEach(p => {
      p.addEventListener('click', () => {
        setAppPage(p.textContent.trim());
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
      await hydrateCloudDemoState();
      renderDemoTrades();
      await refreshMarketData();
      scanWatchlist().catch(err => console.error('watchlist scan', err));
      refreshTimer = setInterval(() => {
        refreshMarketData().catch(err => {
          console.error(err);
          setConnection('DATA ERROR', 'var(--red)');
          setHtml('#status-reason', `<b>Data error.</b> ${escapeHtml(marketDataErrorHint(CONFIG.symbol, err))}. Keeping last rendered analysis.`);
        });
      }, CONFIG.refreshMs);
      watchlistTimer = setInterval(() => {
        scanWatchlist().catch(err => console.error('watchlist scan', err));
      }, Math.max(CONFIG.refreshMs * 2, 120000));
    } catch(err){
      console.error(err);
      setConnection('DATA ERROR', 'var(--red)');
      setHtml('#status-reason', `<b>Data error.</b> ${escapeHtml(marketDataErrorHint(CONFIG.symbol, err))}.`);
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
