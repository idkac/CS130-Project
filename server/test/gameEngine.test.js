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

test("expandedDeployment allows pawns on the forward rank", () => {
  const whitePlayer = {
    color: "white",
    powerups: ["expandedDeployment"],
    placedPieces: []
  };
  const blackPlayer = {
    color: "black",
    powerups: ["expandedDeployment"],
    placedPieces: []
  };

  assert.equal(testOnly.canPlaceOnSquare(whitePlayer, "pawn", "e3"), true);
  assert.equal(testOnly.canPlaceOnSquare(blackPlayer, "pawn", "e6"), true);
});

test("squareBlockade acts as a one-shot mine during placement", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToPlacement(manager, match);

  match.players[0].powerups.push("squareBlockade");
  assert.throws(
    () => manager.blockSquare(match.id, alice.id, { square: "a7" }),
    { message: "Mines cannot be placed in the opponent's back two ranks." }
  );

  manager.blockSquare(match.id, alice.id, { square: "a6" });
  assert.deepEqual(match.players[0].blockedSquares, ["a6"]);

  match.players[1].inventory.pawn = 5;
  match.players[1].powerups.push("expandedDeployment");
  manager.placePiece(match.id, bob.id, { pieceType: "pawn", square: "a6" });

  assert.deepEqual(match.players[0].blockedSquares, []);
  assert.equal(match.players[1].inventory.pawn, 4);
  assert.equal(match.players[1].placedPieces.some((piece) => piece.square === "a6"), false);

  match.players[1].inventory.pawn = 5;
  manager.placePiece(match.id, bob.id, { pieceType: "pawn", square: "a6" });
  assert.equal(match.players[1].placedPieces.some((piece) => piece.square === "a6"), true);
});

function advanceToPlacement(manager, matchRef) {
  matchRef.phaseEndsAt = new Date(Date.now() - 1).toISOString();
  manager.advanceExpiredMatches(); // triggers → shop

  matchRef.players[0].pawnCount = 200;
  matchRef.players[1].pawnCount = 200;

  manager.ready(matchRef.id, alice.id);
  manager.ready(matchRef.id, bob.id); // → placement
}

// Helper: advance through clicking and shop phases, reaching chess with both kings placed.
function advanceToChess(manager, matchRef) {
  advanceToPlacement(manager, matchRef);

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

test("doubleStepPawns allows a pawn to advance two squares from a non-starting rank", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].powerups.push("doubleStepPawns");
  match.chess.fen = "4k3/8/8/8/8/4P3/8/4K3 w - - 0 1";

  manager.submitMove(match.id, alice.id, { from: "e3", to: "e5" });

  assert.match(match.chess.fen, /^4k3\/8\/8\/4P3\/8\/8\/8\/4K3 b/);
});

test("bishopKnights is a one-turn activation for diagonal knight moves", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].powerups.push("bishopKnights");
  match.chess.fen = "7k/8/8/8/8/8/8/K1N5 w - - 0 1";

  assert.throws(
    () => manager.submitMove(match.id, alice.id, { from: "c1", to: "h6" }),
    { message: "Illegal chess move." }
  );

  manager.usePowerup(match.id, alice.id, { powerupId: "bishopKnights" });
  assert.deepEqual(match.players[0].activePowerups, ["bishopKnights"]);

  manager.submitMove(match.id, alice.id, { from: "c1", to: "h6" });

  assert.match(match.chess.fen, /^7k\/8\/7N\/8\/8\/8\/8\/K7 b/);
  assert.equal(match.players[0].usedPowerups.includes("bishopKnights"), true);
  assert.deepEqual(match.players[0].activePowerups, []);
});

test("queenRooks is a one-turn activation for diagonal rook moves", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].powerups.push("queenRooks");
  match.chess.fen = "7k/8/8/8/8/8/8/R3K3 w - - 0 1";

  assert.throws(
    () => manager.submitMove(match.id, alice.id, { from: "a1", to: "g7" }),
    { message: "Illegal chess move." }
  );

  manager.usePowerup(match.id, alice.id, { powerupId: "queenRooks" });
  manager.submitMove(match.id, alice.id, { from: "a1", to: "g7" });

  assert.match(match.chess.fen, /^7k\/6R1\/8\/8\/8\/8\/8\/4K3 b/);
  assert.equal(match.players[0].usedPowerups.includes("queenRooks"), true);
  assert.deepEqual(match.players[0].activePowerups, []);
});

test("squareBlockade mine removes a piece that moves onto it during chess", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].blockedSquares.push("e6");
  match.chess.fen = "4k3/4p3/8/8/8/8/8/4K3 b - - 0 1";

  manager.submitMove(match.id, bob.id, { from: "e7", to: "e6" });

  assert.match(match.chess.fen, /^4k3\/8\/8\/8\/8\/8\/8\/4K3 w/);
  assert.deepEqual(match.players[0].blockedSquares, []);
  assert.equal(match.chess.moves.at(-1).mineTriggered.square, "e6");
});

test("pieceSwap swaps two owned pieces once and uses the turn", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].powerups.push("pieceSwap");
  match.chess.fen = "4k3/8/8/8/8/8/8/RN2K3 w - - 0 1";

  manager.swapPieces(match.id, alice.id, { from: "a1", to: "b1" });

  assert.match(match.chess.fen, /^4k3\/8\/8\/8\/8\/8\/8\/NR2K3 b/);
  assert.equal(match.players[0].usedPowerups.includes("pieceSwap"), true);
  assert.match(match.chess.moves.at(-1).san, /^Swap Ra1<->Nb1$/);

  assert.throws(
    () => manager.swapPieces(match.id, alice.id, { from: "a1", to: "b1" }),
    { message: "You have already used this powerup." }
  );
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
