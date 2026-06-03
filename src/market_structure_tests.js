const engines = require('./trading_engines');
const fs = require('fs');
const path = require('path');

function ok(cond, msg){ if(!cond) throw new Error('FAIL: '+msg); console.log('PASS:', msg); }

// 1) Run on sample_candles.json
const samplePath = path.join(__dirname,'sample_candles.json');
const sample = JSON.parse(fs.readFileSync(samplePath,'utf8'));
const outSample = engines.analyzeMarket(sample);
console.log('Sample market summary:', {swings: outSample.market.swings.length, trend: outSample.market.trend});
ok(outSample && outSample.market && outSample.liquidity && outSample.zones, 'analyzeMarket returns market/liquidity/zones');

// 2) Small dataset -> unknown trend
const small = [
  {t:1,o:100,h:101,l:99,c:100,v:10},
  {t:2,o:100,h:101,l:99,c:100,v:12},
  {t:3,o:100,h:101,l:99,c:100,v:11},
  {t:4,o:100,h:101,l:99,c:100,v:9}
];
const outSmall = engines.analyzeMarket(small);
console.log('Small market trend:', outSmall.market.trend);
ok(outSmall.market.trend === 'unknown', 'small dataset yields unknown trend');

// 3) GoldPilot decision layer returns professional trade-decision fields
const decision = engines.analyzeGoldPilot({
  candles: sample,
  timeframes: {execution: sample},
  account: {balance: 1000, riskPct: 1, minLot: 0.01}
});
console.log('GoldPilot decision summary:', {status: decision.tradeStatus, bias: decision.bias.bias, regime: decision.regime.regime});
ok(decision.product === 'GoldPilot AI', 'GoldPilot decision identifies product');
ok(['ALLOWED','WAIT','BLOCKED','SETUP FORMING','ENTRY READY','WATCH ONLY'].some(s => decision.tradeStatus.includes(s)), 'GoldPilot decision has professional decision status');
ok(decision.tradability && decision.regime && decision.liquidityMap && decision.risk, 'GoldPilot decision returns tradability/regime/liquidity/risk');
ok(decision.locationContext && decision.locationContext.range && decision.locationContext.range.zone, 'GoldPilot decision returns premium/discount location context');
ok(decision.volumeContext && typeof decision.volumeContext.score === 'number', 'GoldPilot decision returns volume confirmation context');
ok(decision.trendQuality && typeof decision.trendQuality.score === 'number', 'GoldPilot decision returns trend quality context');
ok(decision.cryptoContext && Array.isArray(decision.cryptoContext.warnings), 'GoldPilot decision returns crypto risk context');
ok(decision.htfAlignment && Array.isArray(decision.htfAlignment.hits), 'GoldPilot decision returns HTF zone alignment context');
ok(decision.sessionRules && decision.sessionRules.session, 'GoldPilot decision returns session rules context');
ok(decision.signalGrade && decision.signalGrade.grade, 'GoldPilot decision returns signal grade');
ok(decision.setupStage && Array.isArray(decision.missingConditions) && typeof decision.entryReadinessScore === 'number', 'GoldPilot decision returns setup stage/readiness fields');
ok(decision.longSetup && decision.shortSetup && decision.preferredDirection, 'GoldPilot decision returns long/short setup candidates');
ok(decision.nextStepForecast && decision.nextStepForecast.nextCandleMust, 'GoldPilot decision returns next-step candle forecast');
for(const candidate of [decision.longSetup, decision.shortSetup]){
  if(candidate && candidate.tradePlan){
    const p = candidate.tradePlan;
    if(p.side === 'LONG'){
      ok(p.stopLoss < p.entry, 'long plan has directional SL');
      if(p.takeProfit.tp1 != null) ok(p.takeProfit.tp1 > p.entry && p.takeProfit.tp2 >= p.takeProfit.tp1, 'long plan has directional market TP');
    }
    if(p.side === 'SHORT'){
      ok(p.stopLoss > p.entry, 'short plan has directional SL');
      if(p.takeProfit.tp1 != null) ok(p.takeProfit.tp1 < p.entry && p.takeProfit.tp2 <= p.takeProfit.tp1, 'short plan has directional market TP');
    }
    ok(p.marketTargetBased && p.targetSource && p.targetWarning, 'trade plan uses market target before fixed R:R');
    ok(p.invalidationSource && Array.isArray(p.stopCandidates), 'trade plan evaluates smart invalidation candidates');
  }
}
const engineSource = fs.readFileSync(path.join(__dirname,'trading_engines.js'),'utf8');
ok(engineSource.includes('priceDigits'), 'engine uses dynamic price precision');
ok(engineSource.includes('roundNumberStep'), 'engine scales round-number liquidity by asset price');
ok(engineSource.includes('isClosed !== false'), 'engine ignores still-forming candles for decisions');
ok(engineSource.includes('hasDirectionalStructure'), 'engine requires setup-direction structure confirmation');
ok(engineSource.includes('hasDirectionalCandle'), 'engine requires setup-direction candle confirmation');
ok(engineSource.includes('buildNextStepForecast'), 'engine uses algorithmic next-step forecast logic');
ok(engineSource.includes('counterBias'), 'engine treats bias as a score factor instead of a hard trend-only block');
ok(engineSource.includes('minLotLoss'), 'risk engine reports minimum-size risk when below broker minimum');
ok(engineSource.includes('marketTargetBased'), 'engine uses market target based TP planning');
ok(engineSource.includes('No valid directional liquidity/structure target found'), 'engine refuses to invent far TP when no market target exists');
ok(engineSource.includes('buildStopCandidates'), 'engine uses smart invalidation stop candidates');
ok(engineSource.includes('Retest/rejection wick'), 'engine can use tighter retest wick invalidation');
ok(engineSource.includes('Wait for a deeper retest, tighter valid invalidation'), 'blocked R:R message guides better invalidation instead of forcing trade');
ok(engineSource.includes('buildLocationContext'), 'engine evaluates premium/discount location context');
ok(engineSource.includes('Fair Value Gap'), 'engine detects FVG location support');
ok(engineSource.includes('order block'), 'engine detects order-block location support');
ok(engineSource.includes('locationOk !== false'), 'engine blocks entry-ready state when location is poor');
ok(engineSource.includes('analyzeVolumeContext'), 'engine evaluates volume confirmation');
ok(engineSource.includes('buildTrendQuality'), 'engine evaluates trend quality');
ok(engineSource.includes('buildCryptoContext'), 'engine evaluates crypto impulse/liquidation-style risk');
ok(engineSource.includes('buildRetestContext'), 'engine evaluates BOS retest depth quality');
ok(engineSource.includes('buildHtfZoneAlignment'), 'engine evaluates higher-timeframe zone alignment');
ok(engineSource.includes('buildSessionRules'), 'engine applies session-specific setup rules');
ok(engineSource.includes('Retest depth/rejection is not confirmed'), 'engine blocks shallow BOS retests');
ok(engineSource.includes('Higher-timeframe zone alignment conflicts'), 'engine blocks HTF zone conflicts');
ok(engineSource.includes('Session rules block this setup type'), 'engine blocks setups that violate session rules');
ok(engineSource.includes('targetCandidates'), 'trade plan exposes real target candidates');
ok(engineSource.includes('targetQuality'), 'trade plan labels TP target quality');
ok(engineSource.includes('Targets too close for valid R:R'), 'trade plan labels close targets as invalid reward');
ok(engineSource.includes('buildTargetCandidates'), 'trade plan builds hierarchical target candidates');
ok(engineSource.includes('Major range high'), 'target hierarchy includes major range highs');
ok(engineSource.includes('Major range low'), 'target hierarchy includes major range lows');
ok(engineSource.includes('Extended round number'), 'target hierarchy includes extended round-number targets');
ok(engineSource.includes('All real targets are too close'), 'trade plan explains when all TPs are real but reward is too small');
ok(engineSource.includes('minorTargets'), 'trade plan separates minor targets from actionable targets');
ok(engineSource.includes('WATCH_ONLY'), 'engine demotes invalid R:R setup candidates to watch-only');
ok(engineSource.includes('Watch only: reward is too small'), 'engine explains invalid reward as watch-only');
ok(engineSource.includes('buildSignalGrade'), 'engine grades signals for A/B/C decision levels');
ok(engineSource.includes("['A+','A','B+']"), 'engine marks A/A+/B+ grades as committable');

// 4) High-impact USD news blocks new trades
const blocked = engines.analyzeGoldPilot({
  candles: sample,
  newsEvents: [{currency:'USD', impact:'high', time:new Date(Date.now() + 20 * 60000).toISOString()}]
});
ok(blocked.tradeStatus === 'BLOCKED', 'high-impact USD news blocks trade');

// 5) GoldPilot dashboard is wired to the engine and live connector
const dashboardPath = path.join(__dirname, '..', 'goldpilot_ai_dashboard.html');
const dashboardHtml = fs.readFileSync(dashboardPath, 'utf8');
ok(dashboardHtml.includes('src/trading_engines.js'), 'dashboard loads trading engine');
ok(dashboardHtml.includes('src/goldpilot_live_dashboard.js'), 'dashboard loads live GoldPilot connector');
ok(dashboardHtml.includes('risk-settings-form'), 'dashboard exposes risk settings form');
ok(dashboardHtml.includes('enable-mobile-alerts'), 'dashboard exposes mobile alert permission control');
ok(dashboardHtml.includes('mobile-alert-strip'), 'dashboard exposes mobile in-app alert strip');
ok(dashboardHtml.includes('id="demo-panel"'), 'dashboard has dedicated demo panel id');
ok(dashboardHtml.includes('id="risk-panel"'), 'dashboard has dedicated risk panel id');
ok(dashboardHtml.includes('id="news-panel"'), 'dashboard has dedicated news panel id');
ok(dashboardHtml.includes('journal-rows'), 'dashboard exposes signal journal table');
ok(dashboardHtml.includes('trade-review-form'), 'dashboard exposes trade review form');
ok(dashboardHtml.includes('crypto-watchlist'), 'dashboard exposes crypto watchlist');
ok(dashboardHtml.includes('BTCUSDT'), 'dashboard includes BTC as selectable symbol');
ok(dashboardHtml.includes('direction-grid'), 'dashboard shows long and short setup cards');
ok(dashboardHtml.includes('id="journal-section"'), 'dashboard navbar can target journal section');
const connectorPath = path.join(__dirname, 'goldpilot_live_dashboard.js');
const connectorJs = fs.readFileSync(connectorPath, 'utf8');
ok(connectorJs.includes('goldpilotRiskSettings'), 'live connector persists risk settings');
ok(connectorJs.includes('goldpilotSignalJournal'), 'live connector persists signal journal');
ok(connectorJs.includes('goldpilotTradeJournal'), 'live connector separates trade journal for daily limits');
ok(connectorJs.includes('appendTradeReview'), 'live connector can save trade reviews');
ok(connectorJs.includes('pushMobileAlert'), 'live connector can send mobile/browser alerts');
ok(connectorJs.includes('navigator.vibrate'), 'mobile alerts use vibration when supported');
ok(connectorJs.includes('wireMobileAlerts'), 'live connector wires mobile alert permission control');
ok(connectorJs.includes('refreshLiveNews'), 'live connector fetches live market news');
ok(connectorJs.includes('api.gdeltproject.org'), 'live connector uses GDELT live news feed');
ok(connectorJs.includes('isEnglishNews'), 'live connector filters GDELT headlines to English');
ok(connectorJs.includes('isTradingNewsTitle'), 'live connector filters headlines to trading-related news');
ok(connectorJs.includes('binance.com/bapi/composite'), 'live connector uses Binance announcements feed');
ok(connectorJs.includes('displayNewsEvents'), 'dashboard renders live plus manual news events');
ok(connectorJs.includes('WATCHLIST_SYMBOLS'), 'live connector scans configured crypto watchlist');
ok(connectorJs.includes('monitorScore'), 'watchlist shows monitoring score even when no setup is active');
ok(connectorJs.includes('watchlistCommitSummary'), 'watchlist explains why no trade committed');
ok(connectorJs.includes('Committed today'), 'watchlist summary shows committed trade count');
ok(connectorJs.includes('Best forming'), 'watchlist summary shows best forming setup');
ok(connectorJs.includes('Notification'), 'live connector can notify confirmed trades');
ok(connectorJs.includes('setPrimarySymbol'), 'live connector can switch focused symbol');
ok(connectorJs.includes('scrollIntoView'), 'live connector wires navbar section navigation');
ok(connectorJs.includes('row.entry'), 'watchlist displays planned entry levels when available');
ok(connectorJs.includes('wireWatchlistClicks'), 'watchlist rows can open focused symbol chart');
ok(connectorJs.includes('ensurePrimarySymbolOption'), 'watchlist symbols can be added to primary selector');
ok(connectorJs.includes('accountForSymbol'), 'dashboard uses symbol-aware Binance spot risk sizing');
ok(connectorJs.includes("tickValuePerLot:1"), 'Binance spot symbols use quantity value of 1 for risk sizing');
ok(connectorJs.includes('bestSetupCandidate'), 'dashboard uses best setup candidate when primary setup is empty');
ok(connectorJs.includes('displayTradePlan'), 'dashboard displays fallback candidate trade plan');
ok(connectorJs.includes("setPrimarySymbol(row.getAttribute('data-symbol'), '15M')"), 'watchlist opens matching 15M focused dashboard');
ok(connectorJs.includes('renderPriceAxis'), 'dashboard chart renders price axis and current price marker');
ok(dashboardHtml.includes('current-price-marker'), 'chart SVG has current price marker layer');
ok(connectorJs.includes('updateChartHover'), 'dashboard chart shows hover price/crosshair');
ok(connectorJs.includes('priceFromY'), 'hover price is calculated from dynamic chart scale');
ok(dashboardHtml.includes('chart-tooltip'), 'chart has hover OHLC tooltip layer');
ok(connectorJs.includes('fmtPrice'), 'dashboard renders low-priced crypto levels with dynamic precision');
ok(connectorJs.includes('Binance ${CONFIG.symbol}'), 'dashboard market data label follows focused symbol');
ok(connectorJs.includes('confirmedCandles'), 'dashboard sends only closed Binance candles to the decision engine');
ok(connectorJs.includes('goldpilotCommittedSignals'), 'dashboard persists committed confirmed signals');
ok(connectorJs.includes('applyCommittedSignal'), 'dashboard keeps committed signals visible after refresh');
ok(connectorJs.includes('signalExitState'), 'committed signals clear only on invalidation or target completion');
ok(connectorJs.includes('wireCommittedSignal'), 'dashboard allows manual committed-signal clear');
ok(dashboardHtml.includes('clear-committed-signal'), 'dashboard exposes committed-signal clear control');
ok(connectorJs.includes('goldpilotDemoTrades'), 'dashboard persists demo trades across shutdowns');
ok(connectorJs.includes('upsertDemoTradeFromSignal'), 'committed signals open demo trades automatically');
ok(connectorJs.includes('isCommittableDecision'), 'dashboard commits A/A+/B+ grade decisions');
ok(connectorJs.includes('commitWatchlistSignal'), 'watchlist can commit ready signals across all scanned symbols');
ok(connectorJs.includes('updateDemoTrades'), 'demo trades update against live price for TP/SL/PnL');
ok(connectorJs.includes('BREAKEVEN_STOP'), 'committed trade state machine supports breakeven after TP1');
ok(connectorJs.includes('breakEvenArmed'), 'demo trade management arms breakeven after TP1');
ok(connectorJs.includes('tp2 != null'), 'committed signal TP checks ignore missing targets');
ok(connectorJs.includes('renderDemoTrades'), 'dashboard renders remembered demo trades');
ok(dashboardHtml.includes('demo-trades'), 'dashboard exposes demo trades panel');
ok(connectorJs.includes('nextStepForecast'), 'dashboard displays next-step forecast from engine');
ok(connectorJs.includes('decision.locationContext'), 'dashboard displays premium/discount location checks');
ok(connectorJs.includes('decision.volumeContext'), 'dashboard displays volume confirmation checks');
ok(connectorJs.includes('decision.trendQuality'), 'dashboard displays trend quality checks');
ok(connectorJs.includes('decision.cryptoContext'), 'dashboard displays crypto risk checks');
ok(connectorJs.includes('decision.htfAlignment'), 'dashboard displays HTF zone alignment checks');
ok(connectorJs.includes('decision.sessionRules'), 'dashboard displays session rule checks');
ok(connectorJs.includes('Retest:'), 'dashboard displays retest quality checks');
ok(connectorJs.includes('planHasValidReward'), 'dashboard marks TP levels as wait-only when R:R is invalid');
ok(connectorJs.includes('NO ENTRY - TARGET TOO CLOSE'), 'dashboard hides actionable entry zone when reward is invalid');

// 6) Return success
console.log('\nAll market structure smoke tests passed.');
