GoldPilot AI - Gold Trading Decision Engine

This repository is a local MVP prototype for a professional XAUUSD/PAXG gold trading intelligence system.

GoldPilot AI is not meant to be a simple BUY/SELL signal bot. Its main job is to block bad trades first, then describe a valid setup only when context, liquidity, structure, candle behavior, and risk align.

Current modules

- Market Structure Engine: detects swings, trend, BOS, and CHOCH.
- Liquidity Engine: detects equal highs/lows, stop hunts, fake breakouts, and notable levels.
- Zone Engine: identifies impulse-created demand/supply zones and revisits.
- Candle Behavior Engine: scores candle strength, rejection, and breakout quality.
- Tradability Engine: checks session, spread, volatility, and high-impact USD news risk.
- Market Regime Engine: classifies trend, range, sweep/reversal, breakout, news, and low-liquidity modes.
- Multi-Timeframe Bias Engine: weights higher and lower timeframe trend context.
- Setup Detector: watches liquidity sweeps, BOS continuation, and range reversal conditions.
- Invalidation and Risk Engine: creates stop/invalidation, R:R, max loss, and lot-size permission output.
- Management Rules: returns post-entry handling rules for partials, breakeven, and invalidation.

Main API

`src/trading_engines.js` exports:

- `analyzeMarket(candles)` for the original raw structure/liquidity/zones/confirmation/signal output.
- `analyzeGoldPilot(input)` for the product decision output.

Example:

```js
const engines = require('./src/trading_engines');

const decision = engines.analyzeGoldPilot({
  candles,
  timeframes: {
    '4H': candles4h,
    '1H': candles1h,
    '15M': candles15m,
    '5M': candles5m
  },
  account: {
    balance: 1000,
    riskPct: 1,
    minLot: 0.01
  },
  market: {
    spread: 0.2
  },
  newsEvents: [
    { currency: 'USD', impact: 'high', time: '2026-05-29T12:30:00Z', title: 'Core PCE' }
  ]
});

console.log(decision.tradeStatus);
console.log(decision.reason);
```

Decision statuses

- `WAIT`: analysis is active, but setup/entry/risk conditions are not complete.
- `BLOCKED`: news, spread, volatility, or risk rules prohibit a new trade.
- `LONG ALLOWED` / `SHORT ALLOWED`: setup and risk checks are aligned.

Dashboard

Open `goldpilot_ai_dashboard.html` in a browser for the GoldPilot dashboard. It fetches live Binance `PAXGUSDT` candles across 5M, 15M, 1H, 4H, and Daily timeframes, then runs `analyzeGoldPilot()` against the live data.

```powershell
Start-Process goldpilot_ai_dashboard.html
```

The older `live_crypto_dashboard_binance.html` prototype is still present, but the GoldPilot dashboard is the primary UI now.

Temporary free hosting

Cloudflare Pages is the recommended free host for this MVP because the dashboard is static HTML and JavaScript.

Deploy settings:

- Framework preset: None
- Build command: `exit 0`
- Build output directory: `/`
- Production branch: `main`

Steps:

1. Push this folder to a GitHub repository.
2. In Cloudflare, open Workers & Pages.
3. Create application, choose Pages, then import the GitHub repository.
4. Use the deploy settings above.
5. After deploy, open the generated `*.pages.dev` URL.

`index.html` redirects visitors to `goldpilot_ai_dashboard.html`, so the root Pages URL opens the dashboard directly.

Hosting note: risk settings, signal journal, demo trades, and mobile-alert state are stored in browser `localStorage`. They will stay available in the same browser/device, but they are not cloud-synced until a database/backend is added.

24/7 cloud scanner

Cloudflare Pages only runs when someone opens the dashboard. To scan while the browser is closed, deploy the Worker in `cloud_scanner_worker`.

What it does:

- Runs every 15 minutes with Cloudflare Cron Triggers
- Scans the default 12 Binance symbols
- Runs the same GoldPilot engine
- Stores A+, A, and B+ committed signals in Cloudflare D1
- Exposes `/api/latest-signals` for the dashboard or mobile alerts later

Setup:

```powershell
cd cloud_scanner_worker
npm create cloudflare@latest
```

If Wrangler is already available:

```powershell
cd cloud_scanner_worker
wrangler d1 create goldpilot_ai
```

Copy the returned `database_id` into `cloud_scanner_worker/wrangler.toml`.

Apply the schema:

```powershell
wrangler d1 execute goldpilot_ai --file=schema.sql --remote
```

Deploy:

```powershell
wrangler deploy
```

Test manually:

```txt
https://goldpilot-scanner.<your-subdomain>.workers.dev/api/scan
https://goldpilot-scanner.<your-subdomain>.workers.dev/api/latest-signals
```

Security note: `/api/scan` is open in this MVP for easy testing. Before serious use, protect it with a secret token or disable manual scan calls.

Indian market live data

The dashboard cannot fetch Yahoo Finance Indian index candles directly from the browser because Yahoo blocks cross-origin browser requests. For NIFTY, BANK NIFTY, and SENSEX, deploy the lightweight market-data worker. This worker does not need D1.

```powershell
cd indian_market_worker
npx wrangler login
npx wrangler deploy
```

After deploy, set the worker URL in the browser once:

```js
localStorage.setItem('goldpilotMarketApiBase', 'https://goldpilot-market-data.<your-subdomain>.workers.dev')
```

Then reload the dashboard and select `NIFTY 50`, `BANK NIFTY`, or `SENSEX`. The status should show `LIVE` or `PARTIAL DATA`, not `CACHED DATA`.

Manual cache fallback is disabled by default. To temporarily use the bundled snapshot only when the live worker is unavailable:

```js
localStorage.setItem('goldpilotAllowCachedIndianData', 'true')
```

Risk settings

The dashboard includes a Risk Engine settings form. It saves to `localStorage.goldpilotRiskSettings` and is used on every live engine refresh.

Current settings:

- Account balance
- Risk percentage per trade
- Minimum lot size
- Tick value per lot
- Maximum daily loss percentage
- Maximum trades per day

Daily trade limits use `localStorage.goldpilotTradeJournal` when present. Trade rows can include `timestamp` or `date`, plus optional `lossPct`.

Signal journal

The dashboard saves recent engine decision snapshots to `localStorage.goldpilotSignalJournal`.

It stores:

- timestamp
- timeframe
- trade status
- bias and confidence
- market regime
- setup and setup quality
- entry, stop loss, TP1, TP2
- R:R and risk details
- reasons and next conditions

The journal is for decision review, not proof of executed trades. It does not count toward daily trade limits.

Trade review journal

The dashboard also has a Trade Review Journal backed by `localStorage.goldpilotTradeJournal`.

Use it to review executed or missed trades from a saved signal snapshot:

- result: win, loss, breakeven, missed
- review type: valid trade, valid loss, mistake, rule break
- loss percentage for daily-risk tracking
- notes about execution quality or mistakes

Rows in this journal count toward the Risk Engine's daily loss and max-trade checks.

Decision states

The engine now returns richer setup state fields:

- `tradeStatus`: `WAIT`, `SETUP FORMING`, `ENTRY READY`, `BLOCKED`, or an allowed direction
- `longSetup` and `shortSetup`: separate side-specific setup candidates
- `preferredDirection`: `LONG`, `SHORT`, or `NONE`
- `setupStage`: stage such as `NO_SETUP`, `SETUP_FORMING`, `STRUCTURE_CONFIRMED`, `RETEST_NEEDED`, `ENTRY_READY`
- `missingConditions`: exact confirmations still missing
- `entryReadinessScore`: 0-100
- `blockedReasons`: strict blocks such as news, risk, or daily limits
- `allowedActions`: what the trader is allowed to do next

Crypto watchlist alerts

The dashboard scans a configured Binance watchlist in addition to the focused `PAXGUSDT` chart.

The focused chart can also be switched from the top bar symbol selector. `BTCUSDT` is included there and in the default watchlist.

Default symbols:

```txt
PAXGUSDT, BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT,
ADAUSDT, DOGEUSDT, LINKUSDT, AVAXUSDT, MATICUSDT, DOTUSDT
```

The watchlist saves no trades by itself. It only informs when an engine decision reaches `ENTRY READY` or an allowed state. Browser notifications are requested when the first confirmed setup appears.

To customize symbols:

```js
localStorage.goldpilotWatchlistSymbols = JSON.stringify(["BTCUSDT","ETHUSDT","SOLUSDT"]);
```

Data limitations

- `PAXGUSDT` is a Binance gold-backed token pair and a practical MVP proxy, not broker spot `XAUUSD`.
- The news panel is manual until a real economic-calendar API is connected.
- To manually test news blocking in the browser, set `localStorage.goldpilotNewsEvents` to JSON like:

```js
[
  {"currency":"USD","impact":"high","time":"2026-05-30T12:30:00Z","title":"US CPI"}
]
```

Smoke test

```powershell
node src\market_structure_tests.js
```

Important note

This is an analysis prototype, not financial advice and not an auto-trading system. Do not use it for live trading without backtesting, forward testing, broker-specific risk checks, and a verified news/data feed.
