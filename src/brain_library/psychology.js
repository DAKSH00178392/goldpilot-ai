(function(){
  const mod = {
    psychology:[
      {id:'FEAR', meaning:'Participants hesitate or exit early after volatility or losses.', marketClue:['weak pullbacks','failure to reclaim','thin bids'], brainUse:'reduce aggression until reclaim is proven'},
      {id:'FOMO', meaning:'Participants chase after a visible move.', marketClue:['late large candles','entry far from zone','near liquidity target'], brainUse:'activate no-chase and late-entry filter'},
      {id:'PANIC_SELLING', meaning:'Forced selling creates sharp downside displacement and possible exhaustion.', marketClue:['large red candles','volume spike','long lower wicks'], brainUse:'wait for capitulation/reclaim before reversal'},
      {id:'CAPITULATION', meaning:'Final aggressive exit wave after extended move.', marketClue:['climactic candle','liquidity sweep','failed continuation'], brainUse:'look for exhaustion reversal only after structure shifts'},
      {id:'GREED', meaning:'Participants keep buying/selling after easy profits, often near the worst location.', marketClue:['extended move','poor R:R','target nearby'], brainUse:'downgrade continuation entries'},
      {id:'TRAPPED_BUYERS', meaning:'Breakout buyers are stuck after price fails above resistance.', marketClue:['break high then close back below','failed retest','sell-side target opens'], brainUse:'failed-breakout short/fade playbook'},
      {id:'TRAPPED_SELLERS', meaning:'Breakdown sellers are stuck after price fails below support.', marketClue:['break low then close back above','failed retest','buy-side target opens'], brainUse:'failed-breakdown long/fade playbook'},
      {id:'REVENGE_TRADING', meaning:'Trader behavior risk after loss or missed move.', marketClue:['rapid re-entry','ignoring invalidation','oversized risk'], brainUse:'block or reduce autonomy after journal risk flags'}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('psychology', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
