(function(){
  const mod = {
    marketStructure:[
      {id:'BOS', name:'Break of Structure', meaning:'Continuation structure break after a meaningful swing is taken.', evidence:['close beyond swing high/low','follow-through candle','retest holds'], use:'continuation confirmation'},
      {id:'CHOCH', name:'Change of Character', meaning:'Early sign that control may be shifting from one side to the other.', evidence:['opposite swing break','failed continuation','reclaim after sweep'], use:'reversal warning or entry confirmation'},
      {id:'TREND', name:'Trend', meaning:'Series of higher highs/higher lows or lower highs/lower lows with directional acceptance.', evidence:['swing sequence','EMA slope','pullbacks hold'], use:'directional bias'},
      {id:'SWING_HIGH_LOW', name:'Swing High / Swing Low', meaning:'Local turning points that define structure, liquidity, and invalidation.', evidence:['pivot candle','reaction away','later retest'], use:'targets, stops, and BOS/CHOCH reference'},
      {id:'RANGE', name:'Range', meaning:'Balanced auction between defined high and low where fades often beat breakouts.', evidence:['equal highs/lows','failed breaks','midpoint reaction'], use:'trap and sweep playbooks'},
      {id:'COMPRESSION', name:'Compression', meaning:'Volatility contracts before an expansion attempt.', evidence:['narrow candles','ATR contraction','overlapping range'], use:'wait for expansion plus retest'},
      {id:'EXPANSION', name:'Expansion', meaning:'Range breaks into displacement with bigger candles and wider ATR.', evidence:['large body close','volume expansion','break from compression'], use:'directional opportunity after retest'},
      {id:'MARKET_CYCLE', name:'Market Cycle', meaning:'Accumulation, markup, distribution, markdown phases repeat across markets.', evidence:['range build','breakout','exhaustion','breakdown'], use:'phase-aware strategy selection'}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('market_structure', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();

