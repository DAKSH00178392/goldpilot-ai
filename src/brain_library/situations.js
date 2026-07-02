(function(){
  const mod = {
    situations:[
      {id:'TREND_CONTINUATION', family:'trend', combinesWith:['RETEST_ENTRY','HTF_ALIGNMENT'], avoid:['TRAP_REVERSAL']},
      {id:'LIQUIDITY_REVERSAL', family:'reversal', combinesWith:['SWEEP_RECLAIM','CHOCH_CONFIRMATION'], avoid:['CHASE_ENTRY']},
      {id:'RANGE_TRAP', family:'trap', combinesWith:['SWEEP_RECLAIM','NO_TRADE_FILTER'], avoid:['BREAKOUT_CHASE']},
      {id:'OPENING_DRIVE', family:'session', combinesWith:['OPEN_RANGE_WAIT','SWEEP_RECLAIM'], avoid:['FIRST_CANDLE_ENTRY']},
      {id:'COMPRESSION_EXPANSION', family:'volatility', combinesWith:['BREAK_RETEST','VOLUME_CONFIRMATION'], avoid:['PREDICTIVE_BREAKOUT']},
      {id:'NEWS_VOLATILITY', family:'risk', combinesWith:['NO_TRADE_FILTER'], avoid:['TIGHT_STOP_ENTRY']},
      {id:'GAP_REACTION', family:'session', combinesWith:['OPEN_RANGE_WAIT','SWEEP_RECLAIM'], avoid:['GAP_CHASE']},
      {id:'MIDDAY_CHOP', family:'session', combinesWith:['NO_TRADE_FILTER'], avoid:['LOW_VOLUME_BREAKOUT']}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('situations', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();

