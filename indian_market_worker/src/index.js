const YAHOO_INTERVALS = {
  '1m': {interval:'1m', range:'1d'},
  '5m': {interval:'5m', range:'5d'},
  '15m': {interval:'15m', range:'5d'},
  '1h': {interval:'60m', range:'1mo'},
  '4h': {interval:'60m', range:'3mo', aggregate:4},
  '1d': {interval:'1d', range:'1y'}
};

const ALIASES = {
  NIFTY:'^NSEI',
  NIFTY50:'^NSEI',
  NSEI:'^NSEI',
  BANKNIFTY:'^NSEBANK',
  NIFTYBANK:'^NSEBANK',
  NSEBANK:'^NSEBANK',
  SENSEX:'^BSESN',
  BSESN:'^BSESN'
};

const ALLOWED_SYMBOLS = new Set(['^NSEI', '^NSEBANK', '^BSESN']);

function corsHeaders(){
  return {
    'access-control-allow-origin':'*',
    'access-control-allow-methods':'GET,OPTIONS',
    'access-control-allow-headers':'content-type',
    'cache-control':'no-store'
  };
}

function json(data, status = 200){
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers:Object.assign({'content-type':'application/json; charset=utf-8'}, corsHeaders())
  });
}

function normalizeSymbol(symbol){
  const raw = String(symbol || '').toUpperCase().trim().replace(/\s+/g, '');
  return ALIASES[raw] || raw;
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

function parseJinaYahooPayload(text){
  const body = String(text || '');
  const start = body.indexOf('{"chart"');
  const end = body.lastIndexOf('}');
  if(start < 0 || end <= start) throw new Error('Jina Yahoo snapshot returned no JSON chart payload');
  return JSON.parse(body.slice(start, end + 1));
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
      const res = await fetch(url, {headers:{accept:'application/json'}});
      if(!res.ok) throw new Error(`Yahoo ${res.status}`);
      const rows = normalizeYahooChart(await res.json(), cfg.aggregate || 1);
      if(rows.length) return {source:'yahoo-worker', candles:rows.slice(-limit)};
    } catch(err){
      lastError = err;
    }
  }
  for(const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']){
    try{
      const jinaUrl = `https://r.jina.ai/http://${host}${path}`;
      const res = await fetch(jinaUrl, {headers:{accept:'text/plain'}});
      if(!res.ok) throw new Error(`Jina Yahoo ${res.status}`);
      const rows = normalizeYahooChart(parseJinaYahooPayload(await res.text()), cfg.aggregate || 1);
      if(rows.length) return {source:'jina-yahoo-worker', candles:rows.slice(-limit)};
    } catch(err){
      lastError = err;
    }
  }
  throw lastError || new Error(`${symbol} Yahoo candles unavailable`);
}

export default {
  async fetch(request){
    try{
      const url = new URL(request.url);
      if(request.method === 'OPTIONS') return new Response(null, {status:204, headers:corsHeaders()});
      if(url.pathname === '/api/market-candles'){
        const symbol = normalizeSymbol(url.searchParams.get('symbol'));
        const interval = String(url.searchParams.get('interval') || '15m').toLowerCase();
        const limit = Math.max(5, Math.min(Number(url.searchParams.get('limit')) || 240, 500));
        if(!ALLOWED_SYMBOLS.has(symbol)) return json({error:'unsupported Indian market symbol', symbol}, 400);
        const data = await fetchYahooKlines(symbol, interval, limit);
        return json({symbol, interval, source:data.source, candles:data.candles});
      }
      return json({
        ok:true,
        service:'GoldPilot Indian market data',
        endpoints:['/api/market-candles?symbol=^NSEI&interval=15m&limit=240']
      });
    } catch(err){
      return json({error:err && err.message ? err.message : String(err || 'Worker error')}, 500);
    }
  }
};
