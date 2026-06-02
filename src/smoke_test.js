const engines = require('./trading_engines');
const fs = require('fs');
const path = require('path');
const data = fs.readFileSync(path.join(__dirname,'sample_candles.json'),'utf8');
const candles = JSON.parse(data);
const out = engines.analyzeMarket(candles);
console.log(JSON.stringify(out,null,2));
