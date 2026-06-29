import '../../src/trading_engines.js';

const SYMBOLS = [
  'PAXGUSDT','BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','MATICUSDT','DOTUSDT'
];

const TIMEFRAME = '15M';
const BINANCE = 'https://api.binance.com/api/v3/klines';
const YAHOO_INTERVALS = {
  '1m': {interval:'1m', range:'1d'},
  '5m': {interval:'5m', range:'5d'},
  '15m': {interval:'15m', range:'5d'},
  '1h': {interval:'60m', range:'1mo'},
  '4h': {interval:'60m', range:'3mo', aggregate:4},
  '1d': {interval:'1d', range:'1y'}
};

function json(data, status = 200){
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'access-control-allow-origin':'*',
      'access-control-allow-methods':'GET, POST, OPTIONS',
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

function normalizeYahooChart(result, aggregate = 1){
  const chart = result && result.chart && result.chart.result && result.chart.result[0];
  if(!chart || !chart.timestamp || !chart.indicators || !chart.indicators.quote) throw new Error('Yahoo chart returned no candles');
  const quote = chart.indicators.quote[0] || {};
  const timestamps = chart.timestamp || [];
  const rows = timestamps.map((ts, i) => ({
    t:ts * 1000,
    o:Number(quote.open && quote.open[i]),
    h:Number(quote.high && quote.high[i]),
    l:Number(quote.low && quote.low[i]),
    c:Number(quote.close && quote.close[i]),
    v:Number(quote.volume && quote.volume[i] || 0),
    x:ts * 1000,
    isClosed:true
  })).filter(c => [c.o,c.h,c.l,c.c].every(Number.isFinite));
  if(aggregate <= 1) return rows;
  const grouped = [];
  for(let i = 0; i < rows.length; i += aggregate){
    const chunk = rows.slice(i, i + aggregate);
    if(chunk.length < aggregate) continue;
    grouped.push({
      t:chunk[0].t,
      o:chunk[0].o,
      h:Math.max(...chunk.map(c => c.h)),
      l:Math.min(...chunk.map(c => c.l)),
      c:chunk[chunk.length - 1].c,
      v:chunk.reduce((sum, c) => sum + (c.v || 0), 0),
      x:chunk[chunk.length - 1].x,
      isClosed:true
    });
  }
  return grouped;
}

async function fetchYahooKlines(symbol, interval, limit){
  const cfg = YAHOO_INTERVALS[interval] || YAHOO_INTERVALS['15m'];
  const yahooSymbol = encodeURIComponent(symbol);
  const path = `/v8/finance/chart/${yahooSymbol}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;
  const urls = [
    `https://query1.finance.yahoo.com${path}`,
    `https://query2.finance.yahoo.com${path}`
  ];
  let lastError = null;
  for(const url of urls){
    try{
      const res = await fetch(url, {headers:{'accept':'application/json'}});
      if(!res.ok) throw new Error(`Yahoo ${res.status}`);
      const rows = normalizeYahooChart(await res.json(), cfg.aggregate || 1);
      if(rows.length) return rows.slice(-limit);
    } catch(err){
      lastError = err;
    }
  }
  throw lastError || new Error(`${symbol} Yahoo unavailable`);
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

async function ensureDemoStateTable(env){
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS demo_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

function safeJsonParse(value, fallback){
  try{
    return value ? JSON.parse(value) : fallback;
  } catch(err){
    return fallback;
  }
}

async function getDemoState(env){
  await ensureDemoStateTable(env);
  const {results} = await env.DB.prepare('SELECT key, value, updated_at FROM demo_state').all();
  const rows = results || [];
  const byKey = Object.fromEntries(rows.map(row => [row.key, row]));
  return {
    settings:safeJsonParse(byKey.settings && byKey.settings.value, null),
    committedSignals:safeJsonParse(byKey.committedSignals && byKey.committedSignals.value, null),
    demoTrades:safeJsonParse(byKey.demoTrades && byKey.demoTrades.value, null),
    updatedAt:rows.reduce((latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest, null)
  };
}

async function putDemoState(env, body){
  await ensureDemoStateTable(env);
  const nowIso = new Date().toISOString();
  const allowed = ['settings', 'committedSignals', 'demoTrades'];
  for(const key of allowed){
    if(body[key] === undefined) continue;
    const value = JSON.stringify(body[key]);
    if(value.length > 300000) throw new Error(`${key} payload is too large`);
    await env.DB.prepare(`
      INSERT INTO demo_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(key, value, nowIso).run();
  }
  return getDemoState(env);
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
    if(url.pathname === '/api/market-candles'){
      const symbol = String(url.searchParams.get('symbol') || '').toUpperCase().trim();
      const interval = String(url.searchParams.get('interval') || '15m').toLowerCase();
      const limit = Math.max(5, Math.min(Number(url.searchParams.get('limit')) || 240, 500));
      if(!symbol) return json({error:'symbol is required'}, 400);
      return json({symbol, interval, candles:await fetchYahooKlines(symbol, interval, limit)});
    }
    if(url.pathname === '/api/demo-state'){
      if(request.method === 'GET') return json({state:await getDemoState(env)});
      if(request.method === 'POST'){
        const body = await request.json().catch(() => null);
        if(!body || typeof body !== 'object') return json({error:'Invalid JSON body'}, 400);
        return json({ok:true, state:await putDemoState(env, body)});
      }
      return json({error:'Method not allowed'}, 405);
    }
    return json({ok:true, service:'GoldPilot scanner', endpoints:['/api/scan','/api/latest-signals','/api/market-candles']});
  }
};
