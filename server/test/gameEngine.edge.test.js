import assert from 'node:assert/strict';
import test from 'node:test';
import { GameManager } from '../src/gameEngine.js';
import { PHASES, PIECE_SHOP, POWERUP_SHOP } from '../src/config.js';

const alice = { id: 'alice', username: 'alice' };
const bob   = { id: 'bob',   username: 'bob'   };

function makeMatch() {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  return { manager, match };
}

function advanceToShop(manager, match) {
  match.phaseEndsAt = new Date(Date.now() - 1).toISOString();
  manager.advanceExpiredMatches();
}

function advanceToPlacement(manager, match) {
  advanceToShop(manager, match);
  match.players[0].pawnCount = 500;
  match.players[1].pawnCount = 500;
  manager.ready(match.id, alice.id);
  manager.ready(match.id, bob.id);
}

function advanceToChess(manager, match) {
  advanceToPlacement(manager, match);
  manager.ready(match.id, alice.id);
  manager.ready(match.id, bob.id);
}

test('click increases pawnCount', () => {
  const { manager, match } = makeMatch();
  manager.registerClick(match.id, alice.id);
  assert.equal(match.players[0].pawnCount, 1);
});

test('click is rejected outside clicking phase', () => {
  const { manager, match } = makeMatch();
  advanceToShop(manager, match);
  assert.throws(
    () => manager.registerClick(match.id, alice.id),
    { message: 'Clicks are only allowed during the clicking phase.' }
  );
});

test('click rate limit rejects more than MAX_CLICKS_PER_SECOND', () => {
  const { manager, match } = makeMatch();
  // Flood 15 clicks (the limit) — all should pass
  for (let i = 0; i < 15; i++) manager.registerClick(match.id, alice.id);
  // The 16th within the same second should throw
  assert.throws(
    () => manager.registerClick(match.id, alice.id),
    /click rate/i
  );
});

test('cannot purchase without enough pawns', () => {
  const { manager, match } = makeMatch();
  advanceToShop(manager, match);
  match.players[0].pawnCount = 0;
  assert.throws(
    () => manager.purchase(match.id, alice.id, { itemType: 'piece', itemId: 'knight' }),
    /not enough pawns/i
  );
});

test('cannot purchase beyond maxQuantity', () => {
  const { manager, match } = makeMatch();
  advanceToShop(manager, match);
  match.players[0].pawnCount = 9999;
  // queen maxQuantity is 1
  manager.purchase(match.id, alice.id, { itemType: 'piece', itemId: 'queen' });
  assert.throws(
    () => manager.purchase(match.id, alice.id, { itemType: 'piece', itemId: 'queen' }),
    /maximum/i
  );
});

test('purchasing a powerup deducts cost and adds to powerups list', () => {
  const { manager, match } = makeMatch();
  advanceToShop(manager, match);
  match.players[0].pawnCount = 999;
  manager.purchase(match.id, alice.id, { itemType: 'powerup', itemId: 'timeBonus' });
  assert.ok(match.players[0].powerups.includes('timeBonus'));
  assert.equal(match.players[0].pawnCount, 999 - POWERUP_SHOP.timeBonus.cost);
});

test('purchase is rejected outside shop phase', () => {
  const { manager, match } = makeMatch();
  assert.throws(
    () => manager.purchase(match.id, alice.id, { itemType: 'piece', itemId: 'pawn' }),
    /shop phase/i
  );
});

test('cannot place the same square twice', () => {
  const { manager, match } = makeMatch();
  advanceToPlacement(manager, match);
  match.players[0].inventory.rook = 2;
  manager.placePiece(match.id, alice.id, { pieceType: 'rook', square: 'a1' });
  assert.throws(
    () => manager.placePiece(match.id, alice.id, { pieceType: 'rook', square: 'a1' }),
    /already occupied/i
  );
});

test('cannot place a piece you do not own', () => {
  const { manager, match } = makeMatch();
  advanceToPlacement(manager, match);
  assert.throws(
    () => manager.placePiece(match.id, alice.id, { pieceType: 'queen', square: 'd1' }),
    /not in inventory|inventory/i
  );
});

test('cannot place outside your deployment zone', () => {
  const { manager, match } = makeMatch();
  advanceToPlacement(manager, match);
  match.players[0].inventory.rook = 1;
  assert.throws(
    () => manager.placePiece(match.id, alice.id, { pieceType: 'rook', square: 'a5' }),
    /zone|rank/i
  );
});

test('cannot ready during placement without a king placed', () => {
  const { manager, match } = makeMatch();
  advanceToShop(manager, match);
  manager.ready(match.id, alice.id);
  manager.ready(match.id, bob.id);
  // Remove king from placed pieces
  match.players[0].placedPieces = match.players[0].placedPieces
    .filter(p => p.pieceType !== 'king');
  assert.throws(
    () => manager.ready(match.id, alice.id),
    /king/i
  );
});

test('illegal chess move is rejected', () => {
  const { manager, match } = makeMatch();
  advanceToChess(manager, match);
  match.chess.fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
  assert.throws(
    () => manager.submitMove(match.id, alice.id, { from: 'e1', to: 'e6' }),
    /illegal/i
  );
});

test('cannot move on opponent turn', () => {
  const { manager, match } = makeMatch();
  advanceToChess(manager, match);
  // It is white's (alice's) turn — bob should be rejected
  assert.throws(
    () => manager.submitMove(match.id, bob.id, { from: 'e8', to: 'e7' }),
    /not your turn/i
  );
});

test('resignation ends the match and sets the winner', () => {
  const { manager, match } = makeMatch();
  advanceToChess(manager, match);
  const record = manager.resign(match.id, alice.id);
  assert.equal(match.phase, PHASES.COMPLETE);
  assert.equal(record.winnerId, bob.id);
  assert.equal(record.resultReason, 'resignation');
});

test('timeBonus powerup increases clock at chess start', () => {
  const { manager, match } = makeMatch();
  advanceToPlacement(manager, match);
  match.players[0].powerups.push('timeBonus');
  manager.ready(match.id, alice.id);
  manager.ready(match.id, bob.id);
  // timeBonus adds 30s — clock should be greater than the default
  const defaultClock = 300_000;
  assert.ok(match.players[0].clockMs > defaultClock);
});