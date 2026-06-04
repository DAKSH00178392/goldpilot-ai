import '../../src/trading_engines.js';

const SYMBOLS = [
  'PAXGUSDT','BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','MATICUSDT','DOTUSDT'
];

const TIMEFRAME = '15M';
const BINANCE = 'https://api.binance.com/api/v3/klines';

function json(data, status = 200){
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'access-control-allow-origin':'*',
      'access-control-allow-methods':'GET, OPTIONS',
      'access-control-allow-headers':'content-type'
    }
  });
}

async function fetchKlines(symbol, interval, limit){
  const url = `${BINANCE}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, {headers:{'accept':'application/json'}});
  if(!res.ok) throw new Error(`${symbol} ${interval} Binance ${res.status}`);
  const rows = await res.json();
  const now = Date.now();
  return rows.map(row => ({
    t:Number(row[0]),
    o:Number(row[1]),
    h:Number(row[2]),
    l:Number(row[3]),
    c:Number(row[4]),
    v:Number(row[5]),
    x:Number(row[6]),
    isClosed:Number(row[6]) <= now
  })).filter(c => c.isClosed !== false);
}

function signalSignature(symbol, decision){
  const p = decision.tradePlan || {};
  const tp = p.takeProfit || {};
  return [
    symbol,
    TIMEFRAME,
    p.side,
    decision.signalGrade && decision.signalGrade.grade,
    decision.setup && decision.setup.setup,
    p.entry,
    p.stopLoss,
    tp.tp1
  ].join('|');
}

function signalRow(symbol, decision, nowIso){
  const p = decision.tradePlan;
  const tp = p.takeProfit || {};
  return {
    id:`${Date.now()}-${symbol}-${Math.random().toString(36).slice(2, 8)}`,
    signature:signalSignature(symbol, decision),
    symbol,
    timeframe:TIMEFRAME,
    side:p.side,
    grade:decision.signalGrade.grade,
    status:decision.tradeStatus,
    setup:decision.setup && decision.setup.setup || null,
    score:decision.entryReadinessScore || 0,
    entry:p.entry,
    stop_loss:p.stopLoss,
    tp1:tp.tp1,
    tp2:tp.tp2,
    risk_reward:p.riskReward,
    target_source:p.targetSource || null,
    target_quality:p.targetQuality || null,
    reason:[...(decision.reason || []), ...(decision.nextConditionNeeded || [])].slice(0, 4).join(' | '),
    created_at:nowIso
  };
}

async function insertSignal(db, row){
  await db.prepare(`
    INSERT OR IGNORE INTO committed_signals (
      id, signature, symbol, timeframe, side, grade, status, setup, score,
      entry, stop_loss, tp1, tp2, risk_reward, target_source, target_quality,
      reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    row.id, row.signature, row.symbol, row.timeframe, row.side, row.grade,
    row.status, row.setup, row.score, row.entry, row.stop_loss, row.tp1,
    row.tp2, row.risk_reward, row.target_source, row.target_quality,
    row.reason, row.created_at
  ).run();
}

async function scanSymbol(symbol, env, nowIso){
  const [m15, h1] = await Promise.all([
    fetchKlines(symbol, '15m', 260),
    fetchKlines(symbol, '1h', 180)
  ]);
  const decision = globalThis.TradingEngines.analyzeGoldPilot({
    candles:m15,
    timeframes:{'15M':m15,'1H':h1},
    account:{
      symbol,
      balance:1000,
      riskPct:1,
      minLot:0.01,
      tickValuePerLot:1,
      sizingMode:'BINANCE_SPOT_QUANTITY'
    },
    market:{spread:0},
    newsEvents:[],
    now:nowIso
  });
  if(decision.signalGrade && decision.signalGrade.committable && decision.tradePlan){
    const row = signalRow(symbol, decision, nowIso);
    await insertSignal(env.DB, row);
    return {symbol, committed:true, grade:row.grade, side:row.side, setup:row.setup, entry:row.entry, tp1:row.tp1, riskReward:row.risk_reward};
  }
  return {
    symbol,
    committed:false,
    status:decision.tradeStatus,
    grade:decision.signalGrade && decision.signalGrade.grade,
    score:decision.entryReadinessScore || 0,
    reason:(decision.missingConditions || decision.nextConditionNeeded || decision.reason || []).slice(0, 2).join(' | ')
  };
}

async function runScan(env){
  const nowIso = new Date().toISOString();
  const results = [];
  for(const symbol of SYMBOLS){
    try{
      results.push(await scanSymbol(symbol, env, nowIso));
    } catch(err){
      results.push({symbol, error:err.message});
    }
  }
  return {time:nowIso, committed:results.filter(r => r.committed), results};
}

async function latestSignals(env, limit = 50){
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const {results} = await env.DB.prepare(`
    SELECT * FROM committed_signals
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(safeLimit).all();
  return results || [];
}

export default {
  async scheduled(event, env, ctx){
    ctx.waitUntil(runScan(env));
  },

  async fetch(request, env){
    if(request.method === 'OPTIONS') return json({ok:true});
    const url = new URL(request.url);
    if(url.pathname === '/api/scan'){
      return json(await runScan(env));
    }
    if(url.pathname === '/api/latest-signals'){
      return json({signals:await latestSignals(env, url.searchParams.get('limit'))});
    }
    return json({ok:true, service:'GoldPilot scanner', endpoints:['/api/scan','/api/latest-signals']});
  }
};
