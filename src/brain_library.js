// GoldPilot adaptive brain knowledge base aggregator.
(function(){
  function loadNodeModules(){
    if(typeof require !== 'function') return {};
    return {
      philosophy:require('./brain_library/philosophy'),
      marketStructure:require('./brain_library/market_structure'),
      liquidity:require('./brain_library/liquidity'),
      concepts:require('./brain_library/concepts'),
      indicators:require('./brain_library/indicators'),
      psychology:require('./brain_library/psychology'),
      situations:require('./brain_library/situations'),
      playbooks:require('./brain_library/playbooks'),
      hybridStrategies:require('./brain_library/hybrid_strategies'),
      indian:require('./brain_library/indian_markets'),
      cryptoGold:require('./brain_library/crypto_gold'),
      risk:require('./brain_library/risk'),
      memory:require('./brain_library/memory')
    };
  }

  function browserModules(){
    return (typeof globalThis !== 'undefined' && globalThis.GoldPilotBrainModules) || {};
  }

  function flatten(values, key){
    return values.flatMap(mod => Array.isArray(mod && mod[key]) ? mod[key] : []);
  }

  function mergeMarketRules(values){
    return values.reduce((acc, mod) => {
      const rules = mod && mod.marketRules || {};
      Object.keys(rules).forEach(market => {
        acc[market] = [...(acc[market] || []), ...rules[market]];
      });
      return acc;
    }, {});
  }

  function buildLibrary(){
    const modules = Object.values(Object.keys(browserModules()).length ? browserModules() : loadNodeModules());
    return {
      philosophy:flatten(modules, 'philosophy'),
      tradingPhilosophies:flatten(modules, 'tradingPhilosophies'),
      marketStructure:flatten(modules, 'marketStructure'),
      liquidity:flatten(modules, 'liquidity'),
      concepts:flatten(modules, 'concepts'),
      indicators:flatten(modules, 'indicators'),
      psychology:flatten(modules, 'psychology'),
      situations:flatten(modules, 'situations'),
      tactics:flatten(modules, 'tactics'),
      hybridStrategies:flatten(modules, 'hybridStrategies'),
      marketRules:mergeMarketRules(modules),
      marketPersonality:modules.reduce((acc, mod) => Object.assign(acc, mod && mod.marketPersonality || {}), {}),
      riskRules:flatten(modules, 'riskRules'),
      mixRules:flatten(modules, 'mixRules'),
      memoryPatterns:flatten(modules, 'memoryPatterns')
    };
  }

  const library = buildLibrary();
  if(typeof globalThis !== 'undefined') globalThis.GoldPilotBrainLibrary = library;
  if(typeof window !== 'undefined') window.GoldPilotBrainLibrary = library;
  if(typeof module !== 'undefined' && module.exports) module.exports = library;
})();
