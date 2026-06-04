CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  wins         INTEGER NOT NULL DEFAULT 0,
  losses       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id            TEXT PRIMARY KEY,
  player_ids    TEXT[]  NOT NULL,
  players       JSONB   NOT NULL,
  winner_id     TEXT,
  result_reason TEXT,
  move_count    INTEGER NOT NULL DEFAULT 0,
  final_fen     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);