(function(){
  const mod = {
    tactics:[
      {id:'SWEEP_RECLAIM', name:'Sweep and reclaim', needs:['liquidity sweep','reclaim close','near invalidation'], commitScore:76},
      {id:'CHOCH_CONFIRMATION', name:'CHOCH confirmation', needs:['structure shift','follow-through candle'], commitScore:78},
      {id:'RETEST_ENTRY', name:'Retest entry', needs:['BOS','controlled pullback','acceptance'], commitScore:74},
      {id:'BREAK_RETEST', name:'Breakout retest', needs:['range expansion','retest','volume support'], commitScore:80},
      {id:'NO_TRADE_FILTER', name:'No-trade filter', needs:['unclear context or poor risk'], commitScore:101},
      {id:'HTF_ALIGNMENT', name:'Higher timeframe alignment', needs:['bias agreement','clean target path'], commitScore:72},
      {id:'OPEN_RANGE_SWEEP', name:'Opening range sweep', needs:['opening range high/low','sweep','failed continuation'], commitScore:82},
      {id:'LATE_ENTRY_FILTER', name:'Late entry filter', needs:['distance from zone','near target','poor R:R'], commitScore:101},
      {id:'FAILED_BREAKOUT_FADE', name:'Failed breakout fade', needs:['breakout failure','close back in range','opposite liquidity target'], commitScore:79},
      {id:'GAP_REACTION_TRADE', name:'Gap reaction trade', needs:['gap context','first reaction complete','reclaim or rejection'], commitScore:81},
      {id:'MITIGATION_CONTINUATION', name:'Mitigation continuation', needs:['trend displacement','return to imbalance','continuation candle'], commitScore:77},
      {id:'VALUE_ACCEPTANCE', name:'Value acceptance', needs:['acceptance above/below level','hold on retest','target path'], commitScore:75},
      {id:'EXHAUSTION_REVERSAL', name:'Exhaustion reversal', needs:['extended move','divergence or wick rejection','structure shift'], commitScore:83},
      {id:'TIME_STOP_FILTER', name:'Time stop filter', needs:['setup not moving','session time decay','lost momentum'], commitScore:101}
    ],
    mixRules:[
      {id:'TREND_PULLBACK_BLEND', use:['TREND_CONTINUATION','RETEST_ENTRY','HTF_ALIGNMENT'], result:'Trade continuation only after controlled retest confirms.'},
      {id:'TRAP_REVERSAL_BLEND', use:['RANGE_TRAP','LIQUIDITY_REVERSAL','SWEEP_RECLAIM'], result:'Favor reversal only after sweep/reclaim proves trapped side.'},
      {id:'OPEN_TRAP_BLEND', use:['OPENING_DRIVE','RANGE_TRAP','OPEN_RANGE_WAIT'], result:'Wait first, then trade the failed side of the opening drive.'},
      {id:'VOL_EXPANSION_BLEND', use:['COMPRESSION_EXPANSION','BREAK_RETEST','VOLUME_CONFIRMATION'], result:'Let expansion happen, then decide on retest acceptance.'},
      {id:'GAP_FADE_BLEND', use:['GAP_REACTION','LIQUIDITY_REVERSAL','SWEEP_RECLAIM'], result:'Do not predict the gap; trade only after first reaction fails.'},
      {id:'FAILED_BREAK_BLEND', use:['RANGE_TRAP','FAILED_BREAKOUT_FADE','TARGET_FIRST_THINKING'], result:'Fade failed breakout only when target path is clean and invalidation is close.'},
      {id:'MITIGATION_BLEND', use:['TREND_CONTINUATION','MITIGATION_CONTINUATION','FVG'], result:'Use imbalance retest as continuation evidence, not as standalone permission.'},
      {id:'EXHAUSTION_BLEND', use:['LIQUIDITY_REVERSAL','EXHAUSTION_REVERSAL','RSI_DIVERGENCE'], result:'Reversal becomes interesting only after exhaustion appears at liquidity and structure shifts.'}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('playbooks', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
