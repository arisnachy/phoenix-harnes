-- PHOENIX cloud PAPER ledger. No exchange credentials or private account balances.
CREATE TABLE IF NOT EXISTS engine_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  document TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_fence (
  slot INTEGER PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_fence_at ON run_fence(at);
