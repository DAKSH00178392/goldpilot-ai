// Shared registration helper for GoldPilot brain library modules.
(function(){
  function registerBrainModule(name, payload){
    const root = typeof globalThis !== 'undefined' ? globalThis : window;
    root.GoldPilotBrainModules = root.GoldPilotBrainModules || {};
    root.GoldPilotBrainModules[name] = payload || {};
    return payload || {};
  }

  if(typeof globalThis !== 'undefined') globalThis.registerGoldPilotBrainModule = registerBrainModule;
  if(typeof window !== 'undefined') window.registerGoldPilotBrainModule = registerBrainModule;
  if(typeof module !== 'undefined' && module.exports) module.exports = registerBrainModule;
})();

