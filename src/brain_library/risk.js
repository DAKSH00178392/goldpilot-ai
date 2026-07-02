(function(){
  const mod = {
    riskRules:[
      {id:'MIN_RR', rule:'Do not approve a trade if realistic target gives less than minimum reward.'},
      {id:'LOGICAL_INVALIDATION', rule:'Stop must sit beyond structure, sweep, or rejection logic, not random distance.'},
      {id:'TARGET_PATH', rule:'Trade path must not run directly into nearby actionable liquidity.'},
      {id:'DAILY_LIMIT', rule:'After daily loss or trade count limit, brain can observe but not commit.'},
      {id:'LATE_DISTANCE', rule:'If entry is far from decision zone, wait for retest or new setup.'},
      {id:'CORRELATED_CONFLICT', rule:'If correlated markets disagree, reduce autonomy and require cleaner confirmation.'},
      {id:'EVENT_WINDOW', rule:'Before high-impact events, brain can observe but should not commit new trades.'},
      {id:'SPREAD_SLIPPAGE', rule:'If spread or slippage risk consumes too much stop distance, block entry.'},
      {id:'TIME_DECAY', rule:'If setup has not reacted after its expected window, cancel or downgrade it.'},
      {id:'PARTIAL_PROFIT', rule:'When TP1 is reached, protect capital before seeking runner profit.'},
      {id:'ONE_GOOD_TRADE', rule:'After one clean committed trade, reduce frequency and avoid forcing another.'}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('risk', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
