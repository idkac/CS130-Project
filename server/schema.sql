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

CREATE TABLE IF NOT EXISTS moves (
  id            TEXT PRIMARY KEY,
  match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  move_number   INTEGER NOT NULL,
  from_square   TEXT NOT NULL,
  to_square     TEXT NOT NULL,
  san           TEXT,
  promotion     TEXT,
  kind          TEXT NOT NULL DEFAULT 'standard',
  mine_triggered JSONB,
  fen_after     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (match_id, move_number)
);
