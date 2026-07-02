(function(){
  const mod = {
    indicators:[
      {id:'ATR', category:'indicator', purpose:'Measures volatility for stop buffer, target realism, and market regime.', useAs:['risk sizing','stop distance','volatility filter'], warning:'ATR is not directional.'},
      {id:'RSI', category:'indicator', purpose:'Momentum oscillator for exhaustion, divergence, and overextended conditions.', useAs:['divergence','late-entry warning','mean reversion evidence'], warning:'RSI overbought/oversold can stay extreme in strong trends.'},
      {id:'MACD', category:'indicator', purpose:'Trend momentum and momentum-shift confirmation.', useAs:['momentum shift','trend confirmation'], warning:'MACD is lagging and should not override structure.'},
      {id:'VOLUME_EXPANSION', category:'indicator', purpose:'Confirms displacement strength and breakout quality.', useAs:['confirmation','trap detection'], warning:'Volume spike into liquidity can be exhaustion, not continuation.'},
      {id:'VWAP', category:'indicator', purpose:'Intraday fair value reference for institutional-style mean and acceptance.', useAs:['session bias','retest quality'], warning:'VWAP alone is not an entry trigger.'},
      {id:'EMA_SLOPE', category:'indicator', purpose:'Shows trend pressure and pullback health.', useAs:['trend quality','continuation filter'], warning:'Lagging signal; avoid using after move is extended.'},
      {id:'BOLLINGER_BANDS', category:'indicator', purpose:'Shows volatility expansion, compression, and mean-reversion extremes.', useAs:['compression','exhaustion','mean reversion context'], warning:'Band touch alone is not a reversal signal.'},
      {id:'RSI_DIVERGENCE', category:'indicator', purpose:'Flags exhaustion when price makes new extreme without momentum confirmation.', useAs:['reversal evidence','late-entry warning'], warning:'Divergence needs structure confirmation.'},
      {id:'OPENING_RANGE', category:'indicator', purpose:'Defines first-session high/low decision boundaries.', useAs:['Indian index opening drive','trap filter'], warning:'First break often fails without retest.'},
      {id:'SESSION_HIGH_LOW', category:'indicator', purpose:'Marks active liquidity pools from the current session.', useAs:['target selection','sweep detection'], warning:'Do not enter directly into session high/low without space.'},
      {id:'PREVIOUS_DAY_LEVELS', category:'indicator', purpose:'Previous day high, low, and close are major liquidity references.', useAs:['bias context','gap reaction','target path'], warning:'First touch can reject or sweep; wait for response.'},
      {id:'VOLUME_PROFILE_VALUE', category:'indicator', purpose:'Value area and high-volume nodes show acceptance zones.', useAs:['acceptance/rejection','target filtering'], warning:'Requires reliable volume data; use as context only.'},
      {id:'ADX_TREND_STRENGTH', category:'indicator', purpose:'Separates trend continuation environments from chop.', useAs:['trend/range classification'], warning:'Late ADX expansion can appear after the best entry.'},
      {id:'CANDLE_BODY_RATIO', category:'indicator', purpose:'Compares body to wick for conviction or rejection.', useAs:['entry confirmation','exhaustion warning'], warning:'One candle is not enough without location.'}
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('indicators', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
