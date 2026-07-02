(function(){
  const mod = {
    marketRules:{
      crypto:[
        'Avoid liquidation wick chase; wait for acceptance.',
        'Impulse moves need retest before commitment.',
        'Weekend and thin liquidity conditions reduce signal trust.',
        'BTC direction can affect altcoin follow-through.'
      ],
      crypto_gold_proxy:[
        'Gold proxy favors liquidity sweep, rejection, and structure shift.',
        'Do not chase into nearby liquidity.',
        'US dollar and yield events can invalidate clean technical reads.',
        'Sharp wicks near prior highs/lows need reclaim confirmation.'
      ]
    }
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('crypto_gold', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();

