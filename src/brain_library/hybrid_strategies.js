(function(){
  const mod = {
    hybridStrategies:[
      {
        id:'WYCKOFF_SMC_SWEEP_REVERSAL',
        name:'Wyckoff + SMC sweep reversal',
        combines:['WYCKOFF','SMART_MONEY_CONCEPTS','LIQUIDITY_SWEEP','CHOCH','VOLUME_SPREAD_ANALYSIS','TRAPPED_SELLERS','TRAPPED_BUYERS'],
        marketCondition:['RANGE_DAY','TRAP_DAY','LIQUIDITY_REVERSAL'],
        entryLogic:['sweep equal high/low','close back inside range','CHOCH in reversal direction','retest holds'],
        invalidation:'beyond sweep extreme',
        avoidWhen:['no reclaim candle','price already reached opposite liquidity','news block active'],
        decision:'COMMIT only after reclaim and structure shift; ALERT while reclaim forms',
        commitScore:76
      },
      {
        id:'TREND_FOLLOWING_SMC_MITIGATION',
        name:'Trend following + SMC mitigation',
        combines:['TREND_FOLLOWING','SMART_MONEY_CONCEPTS','BOS','FVG','ORDER_BLOCK','EMA_SLOPE'],
        marketCondition:['TREND_DAY','TREND_CONTINUATION'],
        entryLogic:['BOS in trend direction','pullback into FVG/order block','acceptance candle','target path clear'],
        invalidation:'beyond mitigation zone or failed retest swing',
        avoidWhen:['pullback is too shallow','entry is mid-leg','opposing HTF zone blocks path'],
        decision:'COMMIT when trend retest confirms; WAIT if price is extended',
        commitScore:74
      },
      {
        id:'AUCTION_FAILED_BREAK_FADE',
        name:'Auction failed-break fade',
        combines:['AUCTION_MARKET_THEORY','MARKET_PROFILE','FAILED_AUCTION','RANGE','TRAPPED_BUYERS','TRAPPED_SELLERS'],
        marketCondition:['RANGE_DAY','RANGE_TRAP'],
        entryLogic:['break outside value/range','failure back inside','trapped side visible','clean return target'],
        invalidation:'outside failed auction extreme',
        avoidWhen:['acceptance outside range','no target back to value','wide invalidation'],
        decision:'COMMIT only after failed auction holds; ALERT on first failure close',
        commitScore:78
      },
      {
        id:'OPEN_RANGE_TRAP_HYBRID',
        name:'Opening range trap hybrid',
        combines:['OPENING_RANGE','LIQUIDITY_SWEEP','TIME_OF_DAY_CONTEXT','BANKNIFTY_WHIPSAW','PRICE_ACTION'],
        marketCondition:['OPENING_DRIVE','GAP_DAY','RANGE_TRAP'],
        entryLogic:['opening range forms','one side swept','price reclaims range','retest or rejection confirms'],
        invalidation:'beyond opening sweep extreme',
        avoidWhen:['first candle chase','no 15m range yet','expiry whipsaw without retest'],
        decision:'WAIT during discovery; ALERT after sweep; COMMIT after reclaim/retest',
        commitScore:82
      },
      {
        id:'MEAN_REVERSION_EXHAUSTION',
        name:'Mean reversion exhaustion reversal',
        combines:['MEAN_REVERSION','RSI','BOLLINGER_BANDS','CAPITULATION','PANIC_SELLING','CHOCH'],
        marketCondition:['LIQUIDITY_REVERSAL','EXPANSION','TRAP_DAY'],
        entryLogic:['extended move into liquidity','exhaustion wick or divergence','CHOCH','risk close to extreme'],
        invalidation:'beyond exhaustion extreme',
        avoidWhen:['trend still accepting extremes','no structure shift','target path too small'],
        decision:'ALERT on exhaustion; COMMIT only after structure confirms',
        commitScore:83
      },
      {
        id:'VSA_ABSORPTION_REVERSAL',
        name:'Volume spread absorption reversal',
        combines:['VOLUME_SPREAD_ANALYSIS','VOLUME_EXPANSION','LIQUIDITY_SWEEP','ACCEPTANCE_REJECTION','PRICE_ACTION'],
        marketCondition:['TRAP_DAY','LIQUIDITY_REVERSAL','RANGE_DAY'],
        entryLogic:['wide spread into liquidity','high volume but poor follow-through','rejection close','opposite retest holds'],
        invalidation:'beyond absorption wick',
        avoidWhen:['volume confirms continuation','no rejection close','spread/slippage risk too high'],
        decision:'ALERT on absorption; COMMIT after opposite acceptance',
        commitScore:79
      }
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('hybrid_strategies', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
