import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import {
  CHESS_CLOCK_MS,
  CHESS_TIME_BONUS_MS,
  CHESS_TIME_PENALTY_MS,
  CHESS_TIME_RECOVER_MS,
  CLICK_PHASE_MS,
  COLORS,
  DEFAULT_PLACEMENTS,
  INITIAL_INVENTORY,
  MAX_CLICKS_PER_SECOND,
  PHASES,
  PIECE_SHOP,
  PIECE_TO_FEN,
  POWERUP_SHOP,
  TIME_SIPHON_DRAIN_MS,
  TIME_SIPHON_GAIN_MS
} from "./config.js";
import { AppError, assertOrThrow } from "./errors.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

function nowIso() {
  return new Date().toISOString();
}

function cloneInventory() {
  return { ...INITIAL_INVENTORY };
}

function createPlayerState(user, color) {
  return {
    userId: user.id,
    username: user.username,
    color,
    pawnCount: 0,
    inventory: cloneInventory(),
    powerups: [],
    usedPowerups: [],
    placedPieces: [],
    ready: false,
    clickTimestamps: [],
    totalClicks: 0,
    clockMs: CHESS_CLOCK_MS,
    clockLastUpdatedAt: null
  };
}

function isSquare(square) {
  return typeof square === "string" && /^[a-h][1-8]$/.test(square);
}

function getRank(square) {
  return Number(square[1]);
}

function isExpanded(player) {
  return player.powerups.includes("expandedDeployment");
}

function canPlaceOnSquare(player, pieceType, square) {
  const rank = getRank(square);

  if (pieceType === "pawn") {
    return player.color === COLORS.WHITE ? rank === 2 : rank === 7;
  }

  if (player.color === COLORS.WHITE) {
    return rank === 1 || rank === 2 || (isExpanded(player) && rank === 3);
  }

  return rank === 8 || rank === 7 || (isExpanded(player) && rank === 6);
}

function pieceCount(placedPieces, pieceType) {
  return placedPieces.filter((piece) => piece.pieceType === pieceType).length;
}

function getPlayer(match, userId) {
  const player = match.players.find((candidate) => candidate.userId === userId);
  if (!player) {
    throw new AppError(403, "User is not part of this match.");
  }
  return player;
}

function getOpponent(match, userId) {
  return match.players.find((candidate) => candidate.userId !== userId) ?? null;
}

function hasBothPlayers(match) {
  return match.players.length === 2;
}

function areBothReady(match) {
  return hasBothPlayers(match) && match.players.every((player) => player.ready);
}

function buildFen(players) {
  const board = new Map();

  for (const player of players) {
    for (const piece of player.placedPieces) {
      const fenPiece = PIECE_TO_FEN[piece.pieceType];
      if (!fenPiece) {
        throw new AppError(400, `Unsupported piece type: ${piece.pieceType}`);
      }

      board.set(
        piece.square,
        player.color === COLORS.WHITE ? fenPiece.toUpperCase() : fenPiece
      );
    }
  }

  const rows = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = "";
    let empty = 0;

    for (const file of FILES) {
      const square = `${file}${rank}`;
      const piece = board.get(square);

      if (piece) {
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        row += piece;
      } else {
        empty += 1;
      }
    }

    if (empty > 0) {
      row += String(empty);
    }
    rows.push(row);
  }

  return `${rows.join("/")} w - - 0 1`;
}

function countPurchasedPieces(player, pieceType) {
  return (player.inventory[pieceType] ?? 0) - (INITIAL_INVENTORY[pieceType] ?? 0);
}

function countPowerup(player, powerupId) {
  return player.powerups.filter((candidate) => candidate === powerupId).length;
}

function serializePlayer(player) {
  return {
    userId: player.userId,
    username: player.username,
    color: player.color,
    pawnCount: player.pawnCount,
    inventory: player.inventory,
    powerups: player.powerups,
    usedPowerups: player.usedPowerups,
    placedPieces: player.placedPieces,
    ready: player.ready,
    totalClicks: player.totalClicks,
    clockMs: player.clockMs,
    clockLastUpdatedAt: player.clockLastUpdatedAt
  };
}

function getGameOverReason(chess) {
  if (chess.isCheckmate()) {
    return "checkmate";
  }
  if (chess.isStalemate()) {
    return "stalemate";
  }
  if (chess.isDraw()) {
    return "draw";
  }
  return "game_over";
}

export class GameManager {
  constructor({ onMatchChanged, onMatchCompleted } = {}) {
    this.matches = new Map();
    this.waitingMatchId = null;
    this.onMatchChanged = onMatchChanged;
    this.onMatchCompleted = onMatchCompleted;
  }

  joinMatchmaking(user) {
    const existingMatch = this.findActiveMatchForUser(user.id);
    if (existingMatch) {
      return existingMatch;
    }

    const waitingMatch = this.waitingMatchId ? this.matches.get(this.waitingMatchId) : null;
    if (waitingMatch && waitingMatch.status === PHASES.WAITING) {
      waitingMatch.players.push(createPlayerState(user, COLORS.BLACK));
      waitingMatch.status = "active";
      this.startClickingPhase(waitingMatch);
      this.waitingMatchId = null;
      this.notify(waitingMatch);
      return waitingMatch;
    }

    const match = {
      id: randomUUID(),
      status: PHASES.WAITING,
      phase: PHASES.WAITING,
      createdAt: nowIso(),
      phaseStartedAt: null,
      phaseEndsAt: null,
      players: [createPlayerState(user, COLORS.WHITE)],
      chess: null,
      winnerId: null,
      resultReason: null,
      completedAt: null,
      recorded: false
    };

    this.matches.set(match.id, match);
    this.waitingMatchId = match.id;
    this.notify(match);
    return match;
  }

  findActiveMatchForUser(userId) {
    for (const match of this.matches.values()) {
      if (match.phase !== PHASES.COMPLETE && match.players.some((player) => player.userId === userId)) {
        return match;
      }
    }
    return null;
  }

  getMatch(matchId) {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new AppError(404, "Match not found.");
    }
    this.updateTimedPhase(match);
    return match;
  }

  registerClick(matchId, userId) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.CLICKING, 409, "Clicks are only allowed during the clicking phase.");

    const player = getPlayer(match, userId);
    const now = Date.now();
    player.clickTimestamps = player.clickTimestamps.filter((timestamp) => now - timestamp < 1000);

    assertOrThrow(
      player.clickTimestamps.length < MAX_CLICKS_PER_SECOND,
      429,
      "Click rate exceeded the server fairness limit."
    );

    player.clickTimestamps.push(now);
    player.totalClicks += 1;
    player.pawnCount += 1;
    this.notify(match);
    return match;
  }

  purchase(matchId, userId, { itemType, itemId }) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.SHOP, 409, "Purchases are only allowed during the shop phase.");

    const player = getPlayer(match, userId);
    player.ready = false;

    if (itemType === "piece") {
      const item = PIECE_SHOP[itemId];
      assertOrThrow(item, 400, "Unknown piece.");
      assertOrThrow(countPurchasedPieces(player, itemId) < item.maxQuantity, 400, "Piece limit reached.");
      assertOrThrow(player.pawnCount >= item.cost, 400, "Not enough pawns.");

      player.pawnCount -= item.cost;
      player.inventory[itemId] = (player.inventory[itemId] ?? 0) + 1;
      this.notify(match);
      return match;
    }

    if (itemType === "powerup") {
      const item = POWERUP_SHOP[itemId];
      assertOrThrow(item, 400, "Unknown powerup.");
      assertOrThrow(countPowerup(player, itemId) < item.maxQuantity, 400, "Powerup limit reached.");
      assertOrThrow(player.pawnCount >= item.cost, 400, "Not enough pawns.");

      player.pawnCount -= item.cost;
      player.powerups.push(itemId);
      this.notify(match);
      return match;
    }

    throw new AppError(400, "Item type must be either piece or powerup.");
  }

  placePiece(matchId, userId, { pieceType, square }) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.PLACEMENT, 409, "Pieces are only placed during the placement phase.");
    assertOrThrow(isSquare(square), 400, "Invalid board square.");
    assertOrThrow(Boolean(PIECE_TO_FEN[pieceType]), 400, "Invalid piece type.");

    const player = getPlayer(match, userId);
    player.ready = false;

    assertOrThrow(canPlaceOnSquare(player, pieceType, square), 400, "Piece cannot be placed on that square.");
    assertOrThrow(
      !match.players.some((candidate) => candidate.placedPieces.some((piece) => piece.square === square)),
      400,
      "Square is already occupied."
    );
    assertOrThrow(
      pieceCount(player.placedPieces, pieceType) < (player.inventory[pieceType] ?? 0),
      400,
      "No remaining pieces of that type are available."
    );

    player.placedPieces.push({ pieceType, square });
    this.notify(match);
    return match;
  }

  removePiece(matchId, userId, square) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.PLACEMENT, 409, "Pieces can only be removed during the placement phase.");
    assertOrThrow(isSquare(square), 400, "Invalid board square.");

    const player = getPlayer(match, userId);
    const before = player.placedPieces.length;
    player.placedPieces = player.placedPieces.filter((piece) => piece.square !== square);
    assertOrThrow(before !== player.placedPieces.length, 404, "No owned piece found on that square.");

    player.ready = false;
    this.notify(match);
    return match;
  }

  ready(matchId, userId) {
    const match = this.getMatch(matchId);
    const player = getPlayer(match, userId);

    if (match.phase === PHASES.SHOP) {
      player.ready = true;
      if (areBothReady(match)) {
        this.startPlacementPhase(match);
      }
      this.notify(match);
      return match;
    }

    if (match.phase === PHASES.PLACEMENT) {
      assertOrThrow(pieceCount(player.placedPieces, "king") === 1, 400, "Place exactly one king before readying.");
      player.ready = true;
      if (areBothReady(match)) {
        this.startChessPhase(match);
      }
      this.notify(match);
      return match;
    }

    throw new AppError(409, "Ready is only valid during shop or placement.");
  }

  submitMove(matchId, userId, { from, to, promotion = "q" }) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.CHESS, 409, "Moves are only allowed during the chess phase.");
    assertOrThrow(isSquare(from) && isSquare(to), 400, "Move squares must be valid chess coordinates.");

    const player = getPlayer(match, userId);
    const chess = new Chess(match.chess.fen);
    const activeColor = chess.turn() === "w" ? COLORS.WHITE : COLORS.BLACK;
    assertOrThrow(player.color === activeColor, 409, "It is not your turn.");

    // Tick the active player's clock
    const now = Date.now();
    if (player.clockLastUpdatedAt) {
      const elapsed = now - new Date(player.clockLastUpdatedAt).getTime();
      player.clockMs = Math.max(0, player.clockMs - elapsed);
    }
    player.clockLastUpdatedAt = null;

    if (player.clockMs <= 0) {
      const opponent = getOpponent(match, userId);
      this.finishMatch(match, opponent?.userId ?? null, "timeout");
      this.notify(match);
      return match;
    }

    // Apply moveTimeRecover powerup
    if (player.powerups.includes("moveTimeRecover")) {
      player.clockMs += CHESS_TIME_RECOVER_MS;
    }

    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      move = null;
    }

    assertOrThrow(Boolean(move), 400, "Illegal chess move.");

    match.chess.fen = chess.fen();
    match.chess.moves.push({
      userId,
      san: move.san,
      from,
      to,
      promotion,
      fen: match.chess.fen,
      createdAt: nowIso()
    });

    if (chess.isGameOver()) {
      const reason = getGameOverReason(chess);
      let winnerId = null;
      if (reason === "checkmate") {
        winnerId = player.userId;
      }
      this.finishMatch(match, winnerId, reason);
    } else {
      // Start the opponent's clock
      const opponent = getOpponent(match, userId);
      if (opponent) {
        opponent.clockLastUpdatedAt = nowIso();
      }
    }

    this.notify(match);
    return match;
  }

  resign(matchId, userId) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.CHESS, 409, "Resignation is only available during chess.");

    getPlayer(match, userId);
    const opponent = getOpponent(match, userId);
    assertOrThrow(Boolean(opponent), 409, "Cannot resign before an opponent joins.");

    this.finishMatch(match, opponent.userId, "resignation");
    this.notify(match);
    return match;
  }

  usePowerup(matchId, userId, { powerupId }) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.CHESS, 409, "Active powerups can only be used during the chess phase.");

    const player = getPlayer(match, userId);
    const item = POWERUP_SHOP[powerupId];
    assertOrThrow(item, 400, "Unknown powerup.");
    assertOrThrow(item.activatable, 400, "This powerup is not an active-use item.");
    assertOrThrow(player.powerups.includes(powerupId), 400, "You do not own this powerup.");
    assertOrThrow(!player.usedPowerups.includes(powerupId), 409, "You have already used this powerup.");

    if (powerupId === "timeSiphon") {
      const opponent = getOpponent(match, userId);
      assertOrThrow(Boolean(opponent), 409, "No opponent found.");

      opponent.clockMs = Math.max(0, opponent.clockMs - TIME_SIPHON_DRAIN_MS);
      player.clockMs += TIME_SIPHON_GAIN_MS;
    }

    player.usedPowerups.push(powerupId);
    this.notify(match);
    return match;
  }

  advanceExpiredMatches() {
    for (const match of this.matches.values()) {
      const oldPhase = match.phase;
      this.updateTimedPhase(match);

      // Check chess clock timeouts
      if (match.phase === PHASES.CHESS) {
        for (const player of match.players) {
          if (player.clockLastUpdatedAt) {
            const elapsed = Date.now() - new Date(player.clockLastUpdatedAt).getTime();
            if (player.clockMs - elapsed <= 0) {
              player.clockMs = 0;
              const opponent = match.players.find((p) => p.userId !== player.userId);
              this.finishMatch(match, opponent?.userId ?? null, "timeout");
              break;
            }
          }
        }
      }

      if (match.phase !== oldPhase) {
        this.notify(match);
      }
    }
  }

  startClickingPhase(match) {
    const now = Date.now();
    match.phase = PHASES.CLICKING;
    match.phaseStartedAt = new Date(now).toISOString();
    match.phaseEndsAt = new Date(now + CLICK_PHASE_MS).toISOString();
    match.players.forEach((player) => {
      player.ready = false;
    });
  }

  startShopPhase(match) {
    match.phase = PHASES.SHOP;
    match.phaseStartedAt = nowIso();
    match.phaseEndsAt = null;
    match.players.forEach((player) => {
      player.ready = false;
      player.clickTimestamps = [];
    });
  }

  startPlacementPhase(match) {
    match.phase = PHASES.PLACEMENT;
    match.phaseStartedAt = nowIso();
    match.phaseEndsAt = null;
    match.players.forEach((player) => {
      player.ready = false;
      if (player.placedPieces.length === 0) {
        player.placedPieces = DEFAULT_PLACEMENTS[player.color].map((piece) => ({ ...piece }));
      }
    });
  }

  startChessPhase(match) {
    const fen = buildFen(match.players);
    try {
      new Chess(fen);
    } catch (error) {
      throw new AppError(400, `Invalid custom board: ${error.message}`);
    }

    match.phase = PHASES.CHESS;
    match.phaseStartedAt = nowIso();
    match.phaseEndsAt = null;
    match.chess = {
      fen,
      moves: []
    };

    // Apply clock powerups
    for (const player of match.players) {
      player.ready = false;
      let clock = CHESS_CLOCK_MS;

      if (player.powerups.includes("timeBonus")) {
        clock += CHESS_TIME_BONUS_MS;
      }

      const opponent = match.players.find((p) => p.userId !== player.userId);
      if (opponent?.powerups.includes("timePenalty")) {
        clock = Math.max(0, clock - CHESS_TIME_PENALTY_MS);
      }

      player.clockMs = clock;
      player.clockLastUpdatedAt = null;
    }

    // White moves first — start white's clock
    const whitePlayer = match.players.find((p) => p.color === COLORS.WHITE);
    if (whitePlayer) {
      whitePlayer.clockLastUpdatedAt = nowIso();
    }
  }

  updateTimedPhase(match) {
    if (match.phase !== PHASES.CLICKING || !match.phaseEndsAt) {
      return;
    }

    if (Date.now() >= new Date(match.phaseEndsAt).getTime()) {
      this.startShopPhase(match);
    }
  }

  finishMatch(match, winnerId, reason) {
    if (match.phase === PHASES.COMPLETE) {
      return;
    }

    match.phase = PHASES.COMPLETE;
    match.status = PHASES.COMPLETE;
    match.winnerId = winnerId;
    match.resultReason = reason;
    match.completedAt = nowIso();

    if (!match.recorded) {
      match.recorded = true;
      this.onMatchCompleted?.(this.toCompletedRecord(match));
    }
  }

  toCompletedRecord(match) {
    return {
      id: match.id,
      playerIds: match.players.map((player) => player.userId),
      players: match.players.map((player) => ({
        userId: player.userId,
        username: player.username,
        color: player.color,
        totalClicks: player.totalClicks
      })),
      winnerId: match.winnerId,
      resultReason: match.resultReason,
      moveCount: match.chess?.moves.length ?? 0,
      finalFen: match.chess?.fen ?? null,
      createdAt: match.createdAt,
      completedAt: match.completedAt
    };
  }

  serialize(match) {
    return {
      id: match.id,
      status: match.status,
      phase: match.phase,
      createdAt: match.createdAt,
      phaseStartedAt: match.phaseStartedAt,
      phaseEndsAt: match.phaseEndsAt,
      serverTime: nowIso(),
      players: match.players.map(serializePlayer),
      chess: match.chess,
      winnerId: match.winnerId,
      resultReason: match.resultReason,
      completedAt: match.completedAt,
      shop: {
        pieces: Object.values(PIECE_SHOP),
        powerups: Object.values(POWERUP_SHOP)
      }
    };
  }

  notify(match) {
    this.onMatchChanged?.(match);
  }
}

export const testOnly = {
  buildFen,
  canPlaceOnSquare
};