// server/src/pgStore.js
import pg from 'pg';
import { normalizeUsername } from './auth.js';

const { Pool } = pg;

export class PgStore {
  constructor(connectionString = process.env.DATABASE_URL) {
    this.pool = new Pool({ connectionString });
  }

  // Called at startup — runs schema migrations
  async load() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        wins          INTEGER NOT NULL DEFAULT 0,
        losses        INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    `);
    return this; // mirrors JsonStore's load() return value
  }

  async getUserById(userId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async getUserByUsername(username) {
    const normalized = normalizeUsername(username);
    const { rows } = await this.pool.query(
      'SELECT * FROM users WHERE LOWER(username) = $1',
      [normalized]
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async createUser(user) {
    await this.pool.query(
      `INSERT INTO users (id, username, password_hash, wins, losses, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.username, user.passwordHash, user.wins ?? 0, user.losses ?? 0, user.createdAt]
    );
    return user;
  }

  async updateUser(userId, updater) {
    const existing = await this.getUserById(userId);
    if (!existing) return null;

    const updated = { ...existing, ...updater(existing) };
    await this.pool.query(
      `UPDATE users SET wins = $1, losses = $2 WHERE id = $3`,
      [updated.wins, updated.losses, userId]
    );
    return updated;
  }

  async recordCompletedMatch(record) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO matches
           (id, player_ids, players, winner_id, result_reason, move_count, final_fen, created_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           winner_id     = EXCLUDED.winner_id,
           result_reason = EXCLUDED.result_reason,
           move_count    = EXCLUDED.move_count,
           final_fen     = EXCLUDED.final_fen,
           completed_at  = EXCLUDED.completed_at`,
        [
          record.id,
          record.playerIds,
          JSON.stringify(record.players),
          record.winnerId ?? null,
          record.resultReason ?? null,
          record.moveCount ?? 0,
          record.finalFen ?? null,
          record.createdAt,
          record.completedAt ?? null,
        ]
      );

      if (record.winnerId) {
        for (const playerId of record.playerIds) {
          const isWinner = playerId === record.winnerId;
          await client.query(
            `UPDATE users
             SET wins   = wins   + $1,
                 losses = losses + $2
             WHERE id = $3`,
            [isWinner ? 1 : 0, isWinner ? 0 : 1, playerId]
          );
        }
      }

      await client.query('COMMIT');
      return record;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getHistoryForUser(userId) {
    const user = await this.getUserById(userId);
    const { rows } = await this.pool.query(
      `SELECT * FROM matches
       WHERE $1 = ANY(player_ids)
       ORDER BY completed_at DESC`,
      [userId]
    );
    return {
      user,
      matches: rows.map(rowToMatch),
    };
  }
}

function rowToUser(row) {
  return {
    id:           row.id,
    username:     row.username,
    passwordHash: row.password_hash,
    wins:         row.wins,
    losses:       row.losses,
    createdAt:    row.created_at,
  };
}

function rowToMatch(row) {
  return {
    id:           row.id,
    playerIds:    row.player_ids,
    players:      row.players,        // already parsed by pg driver from JSONB
    winnerId:     row.winner_id,
    resultReason: row.result_reason,
    moveCount:    row.move_count,
    finalFen:     row.final_fen,
    createdAt:    row.created_at,
    completedAt:  row.completed_at,
  };
}