import assert from "node:assert/strict";
import test from "node:test";
import { PHASES, CHESS_CLOCK_MS, CHESS_TIME_BONUS_MS, CHESS_TIME_PENALTY_MS, CHESS_TIME_RECOVER_MS } from "../src/config.js";
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

test("resign ends the match in favor of the opponent", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  manager.resign(match.id, alice.id);

  assert.equal(match.phase, PHASES.COMPLETE);
  assert.equal(match.winnerId, bob.id);
  assert.equal(match.resultReason, "resignation");
});

test("ready() rejects during placement if no king is placed", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToPlacement(manager, match);

  match.players[0].placedPieces = [];

  assert.throws(
    () => manager.ready(match.id, alice.id),
    { message: "Place exactly one king before readying." }
  );
});

test("click rate limiter rejects more than 15 clicks per second", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);

  for (let i = 0; i < 15; i++) {
    manager.registerClick(match.id, alice.id);
  }

  assert.throws(
    () => manager.registerClick(match.id, alice.id),
    { message: "Click rate exceeded the server fairness limit." }
  );
});

test("removePiece removes a placed piece and resets ready", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToPlacement(manager, match);

  assert.ok(match.players[0].placedPieces.some((p) => p.square === "e1"));
  manager.removePiece(match.id, alice.id, "e1");

  assert.equal(match.players[0].placedPieces.some((p) => p.square === "e1"), false);
  assert.equal(match.players[0].ready, false);
});

test("timeBonus and timePenalty adjust chess clocks at match start", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);

  match.phaseEndsAt = new Date(Date.now() - 1).toISOString();
  manager.advanceExpiredMatches();

  match.players[0].pawnCount = 200;
  match.players[1].pawnCount = 200;
  match.players[0].powerups.push("timeBonus");
  match.players[1].powerups.push("timePenalty");

  manager.ready(match.id, alice.id);
  manager.ready(match.id, bob.id);
  manager.ready(match.id, alice.id);
  manager.ready(match.id, bob.id);

  // alice: base + timeBonus - timePenalty (from bob)
  assert.equal(match.players[0].clockMs, CHESS_CLOCK_MS + CHESS_TIME_BONUS_MS - CHESS_TIME_PENALTY_MS);
  // bob: base only (alice has no timePenalty)
  assert.equal(match.players[1].clockMs, CHESS_CLOCK_MS);
});

test("moveTimeRecover adds time to the clock after each move", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.players[0].powerups.push("moveTimeRecover");
  match.chess.fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
  match.players[0].clockLastUpdatedAt = null;

  const clockBefore = match.players[0].clockMs;
  manager.submitMove(match.id, alice.id, { from: "e2", to: "e4" });

  assert.equal(match.players[0].clockMs, clockBefore + CHESS_TIME_RECOVER_MS);
});

test("pawn promotion uses the requested piece type", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  // White pawn on e7, kings in corners
  match.chess.fen = "7k/4P3/8/8/8/8/8/K7 w - - 0 1";
  match.players[0].clockLastUpdatedAt = null;

  manager.submitMove(match.id, alice.id, { from: "e7", to: "e8", promotion: "r" });

  // White rook (R) should appear on e8
  assert.match(match.chess.fen, /^4R2k\//);
  assert.match(match.chess.moves.at(-1).san, /^e8=R/);
});

test("checkmate ends the match in favor of the attacking player", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  // Black to move: Ra3-a2 delivers back-rank checkmate with two rooks
  match.chess.fen = "k7/8/8/8/8/r7/1r6/K7 b - - 0 1";

  manager.submitMove(match.id, bob.id, { from: "a3", to: "a2" });

  assert.equal(match.phase, PHASES.COMPLETE);
  assert.equal(match.winnerId, bob.id);
  assert.equal(match.resultReason, "checkmate");
});

test("serialize hides opponent placedPieces during placement phase", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToPlacement(manager, match);

  const aliceView = manager.serialize(match, alice.id);
  const bobView = manager.serialize(match, bob.id);

  const bobSeenByAlice = aliceView.players.find((p) => p.userId === bob.id);
  const aliceSeenByBob = bobView.players.find((p) => p.userId === alice.id);

  assert.deepEqual(bobSeenByAlice.placedPieces, [], "Alice should not see Bob's pieces");
  assert.deepEqual(aliceSeenByBob.placedPieces, [], "Bob should not see Alice's pieces");

  const aliceSeenBySelf = aliceView.players.find((p) => p.userId === alice.id);
  assert.ok(aliceSeenBySelf.placedPieces.length > 0, "Alice can still see her own pieces");
});

test("serialize includes legalMoves for the viewer during chess", () => {
  const manager = new GameManager();
  const match = manager.joinMatchmaking(alice);
  manager.joinMatchmaking(bob);
  advanceToChess(manager, match);

  match.chess.fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";

  const aliceView = manager.serialize(match, alice.id);
  const bobView = manager.serialize(match, bob.id);

  // Alice (white) is to move — she should have legal moves
  assert.ok(Object.keys(aliceView.legalMoves).length > 0, "Alice has legal moves on white's turn");
  // Bob (black) is not to move — his legalMoves map is empty
  assert.deepEqual(bobView.legalMoves, {});
});
