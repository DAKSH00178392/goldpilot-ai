(function(){
  const mod = {
    liquidity:[
      {id:'EQUAL_HIGHS', name:'Equal Highs', meaning:'Clustered highs where buy stops likely rest.', evidence:['two or more similar highs','price stalls below','sweep risk'], use:'buy-side liquidity target'},
      {id:'EQUAL_LOWS', name:'Equal Lows', meaning:'Clustered lows where sell stops likely rest.', evidence:['two or more similar lows','price stalls above','sweep risk'], use:'sell-side liquidity target'},
      {id:'LIQUIDITY_SWEEP', name:'Liquidity Sweep', meaning:'Price raids stops beyond a level then rejects.', evidence:['wick through level','close back inside','reclaim'], use:'reversal or trap confirmation'},
      {id:'STOP_HUNT', name:'Stop Hunt', meaning:'Aggressive move into obvious stops before reversing or accepting.', evidence:['fast spike','thin follow-through','opposite close'], use:'avoid chasing; wait for proof'},
      {id:'ORDER_BLOCK', name:'Order Block', meaning:'Decision candle before displacement that can act as mitigation zone.', evidence:['impulse after candle','unmitigated zone','reaction on return'], use:'entry zone after confirmation'},
      {id:'FAIR_VALUE_GAP', name:'Fair Value Gap', meaning:'Three-candle imbalance showing inefficient price delivery.', evidence:['gap between candle 1 and 3','return into gap','reaction'], use:'retest zone or target'},
      {id:'MITIGATION', name:'Mitigation', meaning:'Return to rebalance a prior decision zone before continuation.', evidence:['return to OB/FVG','controlled pullback','continuation candle'], use:'continuation entry evidence'},
      {id:'LIQUIDITY_POOL', name:'Liquidity Pool', meaning:'Area with obvious stops, highs/lows, or session levels attracting price.', evidence:['prior high/low','round number','session extreme'], use:'target and danger zone'}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('liquidity', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();

