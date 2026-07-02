(function(){
  const mod = {
    marketRules:{
      indian_index:[
        'Opening drive needs range formation before commitment.',
        'Bank Nifty requires extra whipsaw tolerance and cleaner retest.',
        'Sensex needs cleaner confirmation than Nifty because isolated signals are weaker.',
        'Gap days require confirmation after the first reaction, not prediction.',
        'Round numbers and option strike zones can pull price before reversal.',
        'Midday compression should reduce trade frequency until range expands.',
        'Closing-hour continuation needs clean target path and no late chase.',
        'First 5 minutes are information, not permission.',
        'If the first 15-minute candle is very large, require a pullback or failed retest before entry.',
        'If price opens near previous day high or low, expect a sweep attempt before direction.',
        'Expiry sessions can make good structure fail near option strike magnets.',
        'If Nifty and Bank Nifty disagree sharply, reduce confidence for index trades.',
        'After 2:45 PM IST, avoid fresh entries unless structure is clean and target is close.',
        'A gap that holds after retest is continuation evidence; a gap that fails becomes trap evidence.'
      ]
    },
    marketPersonality:{
      '^NSEI':['Cleaner structure than Bank Nifty','Respect trend continuation after valid retest','Gap reaction matters more than first candle direction','When Nifty trends cleanly, shallow pullbacks can work if risk is tight and target path is open'],
      '^NSEBANK':['Whipsaw-prone','Needs wider invalidation','Avoid tight stops near round numbers and option strikes','Do not trust first breakout without retest','Fast reversals after liquidity raid are common'],
      '^BSESN':['Needs confirmation from broader index structure','Avoid isolated weak Sensex signals','Cleaner setup threshold should be higher','Use Sensex as confirmation when Nifty and Bank Nifty structure agree']
    },
    sessionKnowledge:{
      openingDrive:['9:15-9:30 IST is discovery','range sweep beats breakout chase','large first candle needs retest'],
      midday:['lower urgency','compression and false breaks are common','prefer no-trade unless setup is very clean'],
      closingHour:['momentum can continue but late entries are dangerous','targets must be nearby','do not enter after move is extended']
    }
  };
  if(typeof registerGoldPilotBrainModule === 'function') registerGoldPilotBrainModule('indian_markets', mod);
  if(typeof module !== 'undefined' && module.exports) module.exports = mod;
})();
