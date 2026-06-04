CREATE TABLE IF NOT EXISTS committed_signals (
  id TEXT PRIMARY KEY,
  signature TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  side TEXT NOT NULL,
  grade TEXT NOT NULL,
  status TEXT NOT NULL,
  setup TEXT,
  score INTEGER,
  entry REAL,
  stop_loss REAL,
  tp1 REAL,
  tp2 REAL,
  risk_reward REAL,
  target_source TEXT,
  target_quality TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_committed_signals_created_at
ON committed_signals(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_committed_signals_symbol_created_at
ON committed_signals(symbol, created_at DESC);
