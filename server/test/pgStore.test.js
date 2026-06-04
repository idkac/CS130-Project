import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PgStore } from '../src/pgStore.js';
import crypto from 'node:crypto';

const store = new PgStore(process.env.TEST_DATABASE_URL);

// Wipe tables before each run
test.before(async () => {
  await store.load();
  await store.pool.query('TRUNCATE users, matches RESTART IDENTITY CASCADE');
});

function uniqueUser(overrides = {}) {
  const id = crypto.randomUUID();
  return {
    id,
    username: `user_${id.slice(0, 8)}`,
    passwordHash: 'salt:hash',
    wins: 0,
    losses: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test('createUser and getUserById round-trip', async () => {
  const user = uniqueUser();
  await store.createUser(user);
  const found = await store.getUserById(user.id);
  assert.equal(found.id, user.id);
  assert.equal(found.username, user.username);
});

test('getUserByUsername is case-insensitive', async () => {
  const user = uniqueUser({ username: 'TestUser' });
  await store.createUser(user);
  const found = await store.getUserByUsername('testuser');
  assert.ok(found);
  assert.equal(found.id, user.id);
});

test('getUserById returns null for unknown id', async () => {
  const result = await store.getUserById('does-not-exist');
  assert.equal(result, null);
});

test('updateUser increments wins', async () => {
  const user = uniqueUser();
  await store.createUser(user);
  await store.updateUser(user.id, (u) => ({ wins: u.wins + 1 }));
  const updated = await store.getUserById(user.id);
  assert.equal(updated.wins, 1);
});

test('recordCompletedMatch saves match and updates win/loss records', async () => {
  const p1 = uniqueUser();
  const p2 = uniqueUser();
  await store.createUser(p1);
  await store.createUser(p2);

  const matchId = crypto.randomUUID();
  await store.recordCompletedMatch({
    id: matchId,
    playerIds: [p1.id, p2.id],
    players: [],
    winnerId: p1.id,
    resultReason: 'checkmate',
    moveCount: 10,
    finalFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });

  const winner = await store.getUserById(p1.id);
  const loser  = await store.getUserById(p2.id);
  assert.equal(winner.wins, 1);
  assert.equal(loser.losses, 1);
});

test('getHistoryForUser returns only that user\'s matches', async () => {
  const p1 = uniqueUser();
  const p2 = uniqueUser();
  await store.createUser(p1);
  await store.createUser(p2);

  await store.recordCompletedMatch({
    id: crypto.randomUUID(),
    playerIds: [p1.id, p2.id],
    players: [],
    winnerId: p1.id,
    resultReason: 'resignation',
    moveCount: 3,
    finalFen: '',
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });

  const { matches } = await store.getHistoryForUser(p1.id);
  assert.ok(matches.length >= 1);
  assert.ok(matches.every(m => m.playerIds.includes(p1.id)));
});