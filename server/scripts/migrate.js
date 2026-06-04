import 'dotenv/config';
import { readFile } from 'fs/promises';
import { PgStore } from '../src/pgStore.js';

const store = new PgStore();
await store.load();

const db = JSON.parse(await readFile('./data/db.json', 'utf8'));

for (const user of db.users) {
  await store.createUser(user);
  console.log('Migrated user:', user.username);
}
for (const match of db.matches) {
  // Skip win/loss increment — users already have correct counts in db.json
  const client = await store.pool.connect();
  await client.query(
    `INSERT INTO matches (id, player_ids, players, winner_id, result_reason, move_count, final_fen, created_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [match.id, match.playerIds, JSON.stringify(match.players), match.winnerId,
     match.resultReason, match.moveCount, match.finalFen, match.createdAt, match.completedAt]
  );
  client.release();
  console.log('Migrated match:', match.id);
}
console.log('Done.');