(function(){
  const mod = {
    memoryPatterns:[
      'Repeated sweeps reduce trust in first breakout.',
      'Compression before expansion requires patience.',
      'Strong trend with shallow retest can continue, but only if target path is open.',
      'After several failed signals, reduce autonomy until a cleaner context appears.',
      'If journal shows repeated chase mistakes, raise retest requirement.',
      'If same symbol produces multiple traps today, demote first-breakout playbooks.',
      'If 50/100 evidence setups repeatedly win in a specific situation, promote that situation-playbook blend.',
      'If high evidence setups fail near the same liquidity zone, mark that zone as dangerous.',
      'Track which session creates the cleanest moves for each symbol.',
      'Track whether the user exits early before the plan or holds invalidated ideas too long.',
      'If opening-drive trades fail twice, block new opening-drive commits for that symbol today.',
      'If Bank Nifty repeatedly snaps back after round-number breaks, require failed-breakout confirmation.'
    ]
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('memory', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
