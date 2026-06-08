import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PgStore } from '../src/pgStore.js';
import crypto from 'node:crypto';

const store = new PgStore(process.env.TEST_DATABASE_URL);
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

function completedMatch(overrides = {}) {
  const timestamp = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    playerIds: [],
    players: [],
    winnerId: null,
    resultReason: 'draw',
    moveCount: 0,
    finalFen: '',
    moves: [],
    createdAt: timestamp,
    completedAt: timestamp,
    ...overrides,
  };
}

function recordedMove(overrides = {}) {
  return {
    userId: '',
    from: '',
    to: '',
    san: null,
    promotion: null,
    kind: 'standard',
    mineTriggered: null,
    fen: '',
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
  await store.recordCompletedMatch(completedMatch({
    id: matchId,
    playerIds: [p1.id, p2.id],
    winnerId: p1.id,
    resultReason: 'checkmate',
    moveCount: 10,
    finalFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  }));

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

  await store.recordCompletedMatch(completedMatch({
    playerIds: [p1.id, p2.id],
    winnerId: p1.id,
    resultReason: 'resignation',
    moveCount: 3,
    finalFen: '',
  }));

  const { matches } = await store.getHistoryForUser(p1.id);
  assert.ok(matches.length >= 1);
  assert.ok(matches.every(m => m.playerIds.includes(p1.id)));
});

test('recordCompletedMatch persists moves', async () => {
  const p1 = uniqueUser();
  const p2 = uniqueUser();
  await store.createUser(p1);
  await store.createUser(p2);

  const matchId = crypto.randomUUID();
  const now = new Date().toISOString();
  await store.recordCompletedMatch(completedMatch({
    id: matchId,
    playerIds: [p1.id, p2.id],
    winnerId: p1.id,
    resultReason: 'checkmate',
    moveCount: 2,
    finalFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    moves: [
      recordedMove({
        userId: p1.id,
        from: 'e2',
        to: 'e4',
        san: 'e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        createdAt: now,
      }),
      recordedMove({
        userId: p2.id,
        from: 'e7',
        to: 'e5',
        san: 'e5',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        createdAt: now,
      }),
    ],
    createdAt: now,
    completedAt: now,
  }));

  const moves = await store.getMovesForMatch(matchId, p1.id);
  assert.equal(moves.length, 2);
  assert.equal(moves[0].moveNumber, 1);
  assert.equal(moves[0].from, 'e2');
  assert.equal(moves[0].san, 'e4');
  assert.equal(moves[1].moveNumber, 2);
  assert.equal(moves[1].from, 'e7');
  assert.equal(moves[1].san, 'e5');
});

test('getMovesForMatch returns null for non-participant', async () => {
  const p1 = uniqueUser();
  const p2 = uniqueUser();
  const outsider = uniqueUser();
  await store.createUser(p1);
  await store.createUser(p2);
  await store.createUser(outsider);

  const matchId = crypto.randomUUID();
  const now = new Date().toISOString();
  await store.recordCompletedMatch(completedMatch({
    id: matchId,
    playerIds: [p1.id, p2.id],
    winnerId: null,
    resultReason: 'stalemate',
    createdAt: now,
    completedAt: now,
  }));

  const result = await store.getMovesForMatch(matchId, outsider.id);
  assert.equal(result, null);
});

test('getMovesForMatch returns empty array for matches with no recorded moves', async () => {
  const p1 = uniqueUser();
  const p2 = uniqueUser();
  await store.createUser(p1);
  await store.createUser(p2);

  const matchId = crypto.randomUUID();
  const now = new Date().toISOString();
  await store.recordCompletedMatch(completedMatch({
    id: matchId,
    playerIds: [p1.id, p2.id],
    winnerId: null,
    resultReason: 'draw',
    createdAt: now,
    completedAt: now,
  }));

  const moves = await store.getMovesForMatch(matchId, p1.id);
  assert.deepEqual(moves, []);
});
