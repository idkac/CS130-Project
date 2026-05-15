import assert from "node:assert/strict";
import test from "node:test";
import { PHASES } from "../src/config.js";
import { GameManager, testOnly } from "../src/gameEngine.js";

const alice = { id: "alice", username: "alice" };
const bob = { id: "bob", username: "bob" };

test("matchmaking creates a two-player clicking match", () => {
  const manager = new GameManager();
  const waitingMatch = manager.joinMatchmaking(alice);

  assert.equal(waitingMatch.phase, PHASES.WAITING);
  assert.equal(waitingMatch.players[0].color, "white");

  const activeMatch = manager.joinMatchmaking(bob);
  assert.equal(activeMatch.id, waitingMatch.id);
  assert.equal(activeMatch.phase, PHASES.CLICKING);
  assert.equal(activeMatch.players[1].color, "black");
  assert.ok(activeMatch.phaseEndsAt);
});

test("clicking phase advances to shop after the timer expires", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);

  match.phaseEndsAt = new Date(Date.now() - 1000).toISOString();
  manager.advanceExpiredMatches();

  assert.equal(match.phase, PHASES.SHOP);
});

test("shop purchases affect inventory and placement starts with default pieces", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);

  match.phaseEndsAt = new Date(Date.now() - 1000).toISOString();
  manager.advanceExpiredMatches();
  match.players[0].pawnCount = 200;

  manager.purchase(match.id, alice.id, { itemType: "piece", itemId: "queen" });
  assert.equal(match.players[0].pawnCount, 50);
  assert.equal(match.players[0].inventory.queen, 1);

  manager.ready(match.id, alice.id);
  manager.ready(match.id, bob.id);

  assert.equal(match.phase, PHASES.PLACEMENT);
  assert.equal(match.players[0].placedPieces.some((piece) => piece.square === "e1"), true);
  assert.equal(match.players[1].placedPieces.some((piece) => piece.square === "e8"), true);
});

test("placement validates zones and builds a custom FEN", () => {
  const whitePlayer = {
    color: "white",
    powerups: [],
    placedPieces: [
      { pieceType: "king", square: "e1" },
      { pieceType: "queen", square: "d1" }
    ]
  };
  const blackPlayer = {
    color: "black",
    powerups: [],
    placedPieces: [{ pieceType: "king", square: "e8" }]
  };

  assert.equal(testOnly.canPlaceOnSquare(whitePlayer, "queen", "d1"), true);
  assert.equal(testOnly.canPlaceOnSquare(whitePlayer, "queen", "d4"), false);
  assert.match(testOnly.buildFen([whitePlayer, blackPlayer]), /^4k3\/8\/8\/8\/8\/8\/8\/3QK3 w - - 0 1$/);
});

// Helper: advance through clicking and shop phases, reaching chess with both kings placed.
function advanceToChess(manager, matchRef) {
  matchRef.phaseEndsAt = new Date(Date.now() - 1).toISOString();
  manager.advanceExpiredMatches(); // triggers → shop

  matchRef.players[0].pawnCount = 200;
  matchRef.players[1].pawnCount = 200;

  manager.ready(matchRef.id, alice.id);
  manager.ready(matchRef.id, bob.id); // → placement

  // Both players already have default pieces (king included), so ready up.
  manager.ready(matchRef.id, alice.id);
  manager.ready(matchRef.id, bob.id); // → chess
}

test("timeSiphon drains opponent clock and credits user", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  // Give alice the powerup directly (simulating a purchase)
  match.players[0].powerups.push("timeSiphon");
  const opponentClockBefore = match.players[1].clockMs;
  const aliceClockBefore = match.players[0].clockMs;

  manager.usePowerup(match.id, alice.id, { powerupId: "timeSiphon" });

  assert.ok(match.players[1].clockMs < opponentClockBefore, "Opponent clock should decrease");
  assert.ok(match.players[0].clockMs > aliceClockBefore, "Alice clock should increase");
  assert.ok(match.players[0].usedPowerups.includes("timeSiphon"), "Marked as used");
});

test("timeSiphon cannot be activated twice", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].powerups.push("timeSiphon");
  manager.usePowerup(match.id, alice.id, { powerupId: "timeSiphon" });

  assert.throws(
    () => manager.usePowerup(match.id, alice.id, { powerupId: "timeSiphon" }),
    { message: "You have already used this powerup." }
  );
});

test("usePowerup rejects unknown or non-activatable powerups", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].powerups.push("moveTimeRecover");

  assert.throws(
    () => manager.usePowerup(match.id, alice.id, { powerupId: "moveTimeRecover" }),
    { message: "This powerup is not an active-use item." }
  );
});

test("usePowerup rejects if powerup not owned", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  assert.throws(
    () => manager.usePowerup(match.id, alice.id, { powerupId: "timeSiphon" }),
    { message: "You do not own this powerup." }
  );
});

test("usePowerup rejects outside chess phase", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);

  match.players[0].powerups.push("timeSiphon");

  assert.throws(
    () => manager.usePowerup(match.id, alice.id, { powerupId: "timeSiphon" }),
    { message: "Active powerups can only be used during the chess phase." }
  );
});

