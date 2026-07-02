(function(){
  const mod = {
    philosophy:[
      {id:'CAPITAL_FIRST', weight:100, rule:'Preserve capital before opportunity. A weak or unclear trade is a no-trade.'},
      {id:'CONTEXT_OVER_CHECKLIST', weight:94, rule:'Current market context can override a rigid setup checklist.'},
      {id:'LIQUIDITY_FIRST', weight:90, rule:'Read liquidity targets, sweeps, and trapped traders before choosing direction.'},
      {id:'NO_CHASE', weight:88, rule:'If price has already left the decision area, wait for a retest or new structure.'},
      {id:'ADAPTIVE_CONFIRMATION', weight:86, rule:'Confirmation requirements change with trend day, range day, opening drive, and trap conditions.'},
      {id:'NO_TRADE_IS_DECISION', weight:80, rule:'Waiting is an active decision when available edge is poor.'},
      {id:'RISK_IS_CONTEXT', weight:78, rule:'A setup with invalid risk is not a setup; it is information.'},
      {id:'PROBABILITY_STACKING', weight:74, rule:'One signal is weak; stacked context, structure, liquidity, and risk create permission.'}
    ],
    tradingPhilosophies:[
      {id:'DOW_THEORY', name:'Dow Theory', core:'Trend is confirmed by structure and market phases, not one candle.', brainUse:'Respect primary trend until structure proves change.'},
      {id:'WYCKOFF', name:'Wyckoff', core:'Markets cycle through accumulation, markup, distribution, and markdown.', brainUse:'Classify range as accumulation/distribution before breakout trust.'},
      {id:'SMART_MONEY_CONCEPTS', name:'Smart Money Concepts', core:'Liquidity, displacement, imbalance, and mitigation define institutional-style decisions.', brainUse:'Use sweeps, FVG, OB, BOS, and CHOCH as evidence, not blind signals.'},
      {id:'MARKET_PROFILE', name:'Market Profile', core:'Price rotates around value and moves when value is accepted or rejected.', brainUse:'Prefer trades that understand value area, extremes, and acceptance.'},
      {id:'AUCTION_MARKET_THEORY', name:'Auction Market Theory', core:'Markets auction to find value; failed auctions create opportunity.', brainUse:'Trade acceptance/rejection and failed auction logic.'},
      {id:'TREND_FOLLOWING', name:'Trend Following', core:'Large moves pay for many small waits/losses.', brainUse:'Allow continuation when trend, retest, and target path align.'},
      {id:'MEAN_REVERSION', name:'Mean Reversion', core:'Extended moves often revert toward value when continuation fails.', brainUse:'Fade extremes only after exhaustion and structure shift.'},
      {id:'TURTLE_TRADING', name:'Turtle Trading', core:'Breakout systems require volatility sizing, discipline, and exits.', brainUse:'Breakout needs expansion and risk sizing; false breaks must be filtered.'},
      {id:'PRICE_ACTION', name:'Price Action', core:'Candles, swings, and reactions reveal intent without relying on indicators.', brainUse:'Make price reaction the final confirmation.'},
      {id:'VOLUME_SPREAD_ANALYSIS', name:'Volume Spread Analysis', core:'Volume plus candle spread reveals effort versus result.', brainUse:'Detect absorption, exhaustion, and false displacement.'}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('philosophy', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
