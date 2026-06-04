import { randomUUID } from "node:crypto";
import { Chess } from "chess.js";
import {
  BLOCKED_SQUARES_PER_POWERUP,
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
const ALL_SQUARES = FILES.flatMap((file) =>
  Array.from({ length: 8 }, (_value, index) => `${file}${index + 1}`)
);
const PROMOTION_PIECES = new Set(["q", "r", "b", "n"]);
const PIECE_FROM_FEN = Object.fromEntries(
  Object.entries(PIECE_TO_FEN).map(([pieceType, fenPiece]) => [fenPiece, pieceType])
);
const PIECE_SAN = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  pawn: ""
};
const TURN_POWERUPS = new Set(["bishopKnights", "queenRooks"]);

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
    activePowerups: [],
    blockedSquares: [],
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
    if (player.color === COLORS.WHITE) {
      return rank === 2 || (isExpanded(player) && rank === 3);
    }
    return rank === 7 || (isExpanded(player) && rank === 6);
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
    activePowerups: player.activePowerups,
    blockedSquares: player.blockedSquares,
    placedPieces: player.placedPieces,
    ready: player.ready,
    totalClicks: player.totalClicks,
    clockMs: player.clockMs,
    clockLastUpdatedAt: player.clockLastUpdatedAt
  };
}

function otherColor(color) {
  return color === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
}

function colorToTurn(color) {
  return color === COLORS.WHITE ? "w" : "b";
}

function turnToColor(turn) {
  return turn === "b" ? COLORS.BLACK : COLORS.WHITE;
}

function getFileIndex(square) {
  return FILES.indexOf(square[0]);
}

function getRankIndex(square) {
  return Number(square[1]);
}

function makeSquare(fileIndex, rank) {
  if (fileIndex < 0 || fileIndex >= FILES.length || rank < 1 || rank > 8) {
    return null;
  }
  return `${FILES[fileIndex]}${rank}`;
}

function parseFenState(fen) {
  const [placement, turn = "w", _castling = "-", _enPassant = "-", halfmove = "0", fullmove = "1"] = fen.split(" ");
  const board = new Map();
  const rows = placement.split("/");

  rows.forEach((row, rowIndex) => {
    const rank = 8 - rowIndex;
    let fileIndex = 0;

    for (const char of row) {
      if (/^[1-8]$/.test(char)) {
        fileIndex += Number(char);
        continue;
      }

      const pieceType = PIECE_FROM_FEN[char.toLowerCase()];
      const square = makeSquare(fileIndex, rank);
      if (pieceType && square) {
        board.set(square, {
          pieceType,
          color: char === char.toUpperCase() ? COLORS.WHITE : COLORS.BLACK
        });
      }
      fileIndex += 1;
    }
  });

  return {
    board,
    turn,
    halfmove: Number(halfmove),
    fullmove: Number(fullmove)
  };
}

function buildFenFromState(board, { turn, halfmove, fullmove }) {
  const rows = [];

  for (let rank = 8; rank >= 1; rank -= 1) {
    let row = "";
    let empty = 0;

    for (const file of FILES) {
      const square = `${file}${rank}`;
      const piece = board.get(square);

      if (!piece) {
        empty += 1;
        continue;
      }

      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }

      const fenPiece = PIECE_TO_FEN[piece.pieceType];
      row += piece.color === COLORS.WHITE ? fenPiece.toUpperCase() : fenPiece;
    }

    if (empty > 0) {
      row += String(empty);
    }
    rows.push(row);
  }

  return `${rows.join("/")} ${turn} - - ${halfmove} ${fullmove}`;
}

function getPlayerByColor(match, color) {
  return match.players.find((player) => player.color === color) ?? null;
}

function hasPowerup(player, powerupId) {
  return player?.powerups.includes(powerupId);
}

function hasActivePowerup(player, powerupId) {
  return player?.activePowerups.includes(powerupId);
}

function clearTurnPowerups(player) {
  player.activePowerups = player.activePowerups.filter((powerupId) => !TURN_POWERUPS.has(powerupId));
}

function isLineClear(board, from, to) {
  const fromFile = getFileIndex(from);
  const toFile = getFileIndex(to);
  const fromRank = getRankIndex(from);
  const toRank = getRankIndex(to);
  const fileStep = Math.sign(toFile - fromFile);
  const rankStep = Math.sign(toRank - fromRank);

  let file = fromFile + fileStep;
  let rank = fromRank + rankStep;
  while (file !== toFile || rank !== toRank) {
    const square = makeSquare(file, rank);
    if (!square || board.has(square)) {
      return false;
    }
    file += fileStep;
    rank += rankStep;
  }

  return true;
}

function pieceAttacksSquare(match, board, from, targetSquare) {
  const piece = board.get(from);
  if (!piece || from === targetSquare) {
    return false;
  }

  const owner = getPlayerByColor(match, piece.color);
  const fileDelta = getFileIndex(targetSquare) - getFileIndex(from);
  const rankDelta = getRankIndex(targetSquare) - getRankIndex(from);
  const absFileDelta = Math.abs(fileDelta);
  const absRankDelta = Math.abs(rankDelta);
  const isDiagonal = absFileDelta === absRankDelta && absFileDelta > 0;
  const isOrthogonal = (fileDelta === 0 && rankDelta !== 0) || (rankDelta === 0 && fileDelta !== 0);

  if (piece.pieceType === "pawn") {
    const direction = piece.color === COLORS.WHITE ? 1 : -1;
    return rankDelta === direction && absFileDelta === 1;
  }

  if (piece.pieceType === "knight") {
    return (
      (absFileDelta === 1 && absRankDelta === 2) ||
      (absFileDelta === 2 && absRankDelta === 1) ||
      (hasActivePowerup(owner, "bishopKnights") && isDiagonal && isLineClear(board, from, targetSquare))
    );
  }

  if (piece.pieceType === "bishop") {
    return isDiagonal && isLineClear(board, from, targetSquare);
  }

  if (piece.pieceType === "rook") {
    return (
      (isOrthogonal && isLineClear(board, from, targetSquare)) ||
      (hasActivePowerup(owner, "queenRooks") && isDiagonal && isLineClear(board, from, targetSquare))
    );
  }

  if (piece.pieceType === "queen") {
    return (isDiagonal || isOrthogonal) && isLineClear(board, from, targetSquare);
  }

  if (piece.pieceType === "king") {
    return Math.max(absFileDelta, absRankDelta) === 1;
  }

  return false;
}

function isSquareAttackedByColor(match, board, square, attackingColor) {
  for (const [from, piece] of board.entries()) {
    if (piece.color === attackingColor && pieceAttacksSquare(match, board, from, square)) {
      return true;
    }
  }
  return false;
}

function isKingInCheck(match, fen, color) {
  const { board } = parseFenState(fen);
  let kingSquare = null;

  for (const [square, piece] of board.entries()) {
    if (piece.color === color && piece.pieceType === "king") {
      kingSquare = square;
      break;
    }
  }

  if (!kingSquare) {
    return true;
  }

  return isSquareAttackedByColor(match, board, kingSquare, otherColor(color));
}

function isExtraMovePattern(player, board, from, to) {
  if (!isSquare(from) || !isSquare(to) || from === to) {
    return false;
  }

  const piece = board.get(from);
  const target = board.get(to);
  if (!piece || piece.color !== player.color || target?.color === player.color || target?.pieceType === "king") {
    return false;
  }

  const fileDelta = getFileIndex(to) - getFileIndex(from);
  const rankDelta = getRankIndex(to) - getRankIndex(from);
  const absFileDelta = Math.abs(fileDelta);
  const absRankDelta = Math.abs(rankDelta);
  const isDiagonal = absFileDelta === absRankDelta && absFileDelta > 0;

  if (piece.pieceType === "pawn" && hasPowerup(player, "doubleStepPawns")) {
    const direction = player.color === COLORS.WHITE ? 1 : -1;
    const jumpedSquare = makeSquare(getFileIndex(from), getRankIndex(from) + direction);
    return fileDelta === 0 && rankDelta === direction * 2 && jumpedSquare && !board.has(jumpedSquare) && !target;
  }

  if (piece.pieceType === "knight" && hasActivePowerup(player, "bishopKnights")) {
    return isDiagonal && isLineClear(board, from, to);
  }

  if (piece.pieceType === "rook" && hasActivePowerup(player, "queenRooks")) {
    return isDiagonal && isLineClear(board, from, to);
  }

  return false;
}

function promotionPieceType(promotion) {
  if (!PROMOTION_PIECES.has(promotion)) {
    return null;
  }
  return PIECE_FROM_FEN[promotion];
}

function getOpponentMineOwner(match, player, square) {
  const opponent = getOpponent(match, player.userId);
  return opponent?.blockedSquares.includes(square) ? opponent : null;
}

function removeMine(player, square) {
  player.blockedSquares = player.blockedSquares.filter((blockedSquare) => blockedSquare !== square);
}

function applyMineToState(match, player, state, square, { consumeMine = false } = {}) {
  const mineOwner = getOpponentMineOwner(match, player, square);
  const piece = state.board.get(square);
  if (!mineOwner || !piece || piece.color !== player.color) {
    return null;
  }

  state.board.delete(square);
  if (consumeMine) {
    removeMine(mineOwner, square);
  }

  return {
    square,
    pieceType: piece.pieceType,
    color: piece.color,
    ownerUserId: mineOwner.userId
  };
}

function applyMineToFen(match, player, fen, square, { consumeMine = false } = {}) {
  const state = parseFenState(fen);
  const mineTriggered = applyMineToState(match, player, state, square, { consumeMine });
  if (!mineTriggered) {
    return {
      fen,
      mineTriggered: null
    };
  }

  return {
    fen: buildFenFromState(state.board, {
      turn: state.turn,
      halfmove: 0,
      fullmove: state.fullmove
    }),
    mineTriggered
  };
}

function formatMineSan(san, mineTriggered) {
  return mineTriggered ? `${san.replace(/[+#]$/, "")} (mine)` : san;
}

function formatCustomSan(match, player, beforePiece, from, to, capturedPiece, promotedType, fenAfter, mineTriggered) {
  const capture = Boolean(capturedPiece);
  let san = "";

  if (beforePiece.pieceType === "pawn") {
    san = capture ? `${from[0]}x${to}` : to;
  } else {
    san = `${PIECE_SAN[beforePiece.pieceType]}${capture ? "x" : ""}${to}`;
  }

  if (promotedType) {
    san += `=${PIECE_SAN[promotedType]}`;
  }

  const opponentColor = otherColor(player.color);
  if (isKingInCheck(match, fenAfter, opponentColor)) {
    san += hasAnyLegalMove(match, opponentColor, fenAfter) ? "+" : "#";
  }

  return formatMineSan(san, mineTriggered);
}

function applyBoardMove(match, player, fen, { from, to, promotion = "q" }, { annotate = true, consumeMine = false } = {}) {
  const state = parseFenState(fen);
  const piece = state.board.get(from);
  const capturedPiece = state.board.get(to) ?? null;
  const finalRank = player.color === COLORS.WHITE ? 8 : 1;
  let promotedType = null;

  assertOrThrow(piece, 400, "No piece found on the source square.");
  assertOrThrow(piece.color === player.color, 400, "You can only move your own pieces.");

  if (piece.pieceType === "pawn" && getRankIndex(to) === finalRank) {
    promotedType = promotionPieceType(promotion);
    assertOrThrow(Boolean(promotedType), 400, "Invalid promotion piece.");
  }

  state.board.delete(from);
  state.board.set(to, {
    ...piece,
    pieceType: promotedType ?? piece.pieceType
  });
  const mineTriggered = applyMineToState(match, player, state, to, { consumeMine });

  const nextTurn = colorToTurn(otherColor(player.color));
  const isPawnMove = piece.pieceType === "pawn";
  const halfmove = isPawnMove || capturedPiece || mineTriggered ? 0 : state.halfmove + 1;
  const fullmove = player.color === COLORS.BLACK ? state.fullmove + 1 : state.fullmove;
  const fenAfter = buildFenFromState(state.board, {
    turn: nextTurn,
    halfmove,
    fullmove
  });

  return {
    fen: fenAfter,
    mineTriggered,
    san: annotate
      ? formatCustomSan(match, player, piece, from, to, capturedPiece, promotedType, fenAfter, mineTriggered)
      : null
  };
}

function legalMoveMapForPlayer(match, player, fen) {
  const state = parseFenState(fen);
  if (state.turn !== colorToTurn(player.color)) {
    return {};
  }

  const chess = new Chess(fen);
  const movesBySquare = {};

  for (const square of ALL_SQUARES) {
    const piece = state.board.get(square);
    if (!piece || piece.color !== player.color) {
      continue;
    }

    const targets = new Set();

    for (const move of chess.moves({ square, verbose: true })) {
      const afterMove = new Chess(fen);
      afterMove.move({
        from: move.from,
        to: move.to,
        promotion: move.promotion ?? "q"
      });
      const mined = applyMineToFen(match, player, afterMove.fen(), move.to);
      if (mined.mineTriggered?.pieceType === "king" || !isKingInCheck(match, mined.fen, player.color)) {
        targets.add(move.to);
      }
    }

    for (const target of ALL_SQUARES) {
      if (!isExtraMovePattern(player, state.board, square, target)) {
        continue;
      }

      const applied = applyBoardMove(match, player, fen, { from: square, to: target }, { annotate: false });
      if (applied.mineTriggered?.pieceType === "king" || !isKingInCheck(match, applied.fen, player.color)) {
        targets.add(target);
      }
    }

    if (targets.size > 0) {
      movesBySquare[square] = [...targets].sort();
    }
  }

  return movesBySquare;
}

function hasAnyLegalMove(match, color, fen) {
  const player = getPlayerByColor(match, color);
  return player ? Object.keys(legalMoveMapForPlayer(match, player, fen)).length > 0 : false;
}

function getMoveOutcome(match, movedPlayer, fenAfter) {
  const nextColor = otherColor(movedPlayer.color);
  const nextHasLegalMove = hasAnyLegalMove(match, nextColor, fenAfter);

  if (!nextHasLegalMove) {
    return {
      reason: isKingInCheck(match, fenAfter, nextColor) ? "checkmate" : "stalemate",
      winnerId: isKingInCheck(match, fenAfter, nextColor) ? movedPlayer.userId : null
    };
  }

  const chess = new Chess(fenAfter);
  if (chess.isDrawByFiftyMoves()) {
    return {
      reason: "draw",
      winnerId: null
    };
  }

  if (
    !match.players.some((player) =>
      ["doubleStepPawns", "bishopKnights", "queenRooks"].some((powerupId) => player.powerups.includes(powerupId))
    ) &&
    chess.isInsufficientMaterial()
  ) {
    return {
      reason: "draw",
      winnerId: null
    };
  }

  return null;
}

function canMineSquare(player, square) {
  const rank = getRank(square);
  if (player.color === COLORS.WHITE) {
    return rank < 7;
  }
  return rank > 2;
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
      assertOrThrow(countPurchasedPieces(player, itemId) < item.maxQuantity, 400, "Maximum quantity already purchased for this piece.");
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

    assertOrThrow(canPlaceOnSquare(player, pieceType, square), 400, "That square is outside your deployment zone.");
    assertOrThrow(
      !match.players.some((candidate) => candidate.placedPieces.some((piece) => piece.square === square)),
      400,
      "Square is already occupied."
    );
    assertOrThrow(
      pieceCount(player.placedPieces, pieceType) < (player.inventory[pieceType] ?? 0),
      400,
      "No remaining inventory for that piece type."
    );

    const mineOwner = getOpponentMineOwner(match, player, square);
    if (mineOwner) {
      player.inventory[pieceType] -= 1;
      removeMine(mineOwner, square);
      this.notify(match);
      return match;
    }

    player.placedPieces.push({ pieceType, square });
    this.notify(match);
    return match;
  }

  blockSquare(matchId, userId, { square }) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.PLACEMENT, 409, "Squares can only be blocked during placement.");
    assertOrThrow(isSquare(square), 400, "Invalid board square.");

    const player = getPlayer(match, userId);
    const limit = countPowerup(player, "squareBlockade") * BLOCKED_SQUARES_PER_POWERUP;
    assertOrThrow(limit > 0, 400, "You do not own Minefield.");
    assertOrThrow(player.blockedSquares.length < limit, 400, "Mine limit reached.");
    assertOrThrow(!player.blockedSquares.includes(square), 400, "Square is already mined.");
    assertOrThrow(canMineSquare(player, square), 400, "Mines cannot be placed in the opponent's back two ranks.");
    assertOrThrow(
      !match.players.some((candidate) => candidate.placedPieces.some((piece) => piece.square === square)),
      400,
      "Cannot mine an occupied square."
    );

    player.ready = false;
    player.blockedSquares.push(square);
    this.notify(match);
    return match;
  }

  unblockSquare(matchId, userId, square) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.PLACEMENT, 409, "Squares can only be unblocked during placement.");
    assertOrThrow(isSquare(square), 400, "Invalid board square.");

    const player = getPlayer(match, userId);
    const before = player.blockedSquares.length;
    player.blockedSquares = player.blockedSquares.filter((blockedSquare) => blockedSquare !== square);
    assertOrThrow(before !== player.blockedSquares.length, 404, "No owned mine found on that square.");

    player.ready = false;
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

  tickActiveClock(match, player) {
    const now = Date.now();
    if (player.clockLastUpdatedAt) {
      const elapsed = now - new Date(player.clockLastUpdatedAt).getTime();
      player.clockMs = Math.max(0, player.clockMs - elapsed);
    }
    player.clockLastUpdatedAt = null;

    if (player.clockMs <= 0) {
      const opponent = getOpponent(match, player.userId);
      this.finishMatch(match, opponent?.userId ?? null, "timeout");
      return false;
    }

    return true;
  }

  applyMoveTimeRecovery(player) {
    if (player.powerups.includes("moveTimeRecover")) {
      player.clockMs += CHESS_TIME_RECOVER_MS;
    }
  }

  finishChessTurn(match, player, fenAfter) {
    clearTurnPowerups(player);
    const outcome = getMoveOutcome(match, player, fenAfter);
    if (outcome) {
      this.finishMatch(match, outcome.winnerId, outcome.reason);
      return;
    }

    const opponent = getOpponent(match, player.userId);
    if (opponent) {
      opponent.clockLastUpdatedAt = nowIso();
    }
  }

  submitMove(matchId, userId, { from, to, promotion = "q" }) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.CHESS, 409, "Moves are only allowed during the chess phase.");
    assertOrThrow(isSquare(from) && isSquare(to), 400, "Move squares must be valid chess coordinates.");

    const player = getPlayer(match, userId);
    const chess = new Chess(match.chess.fen);
    const activeColor = turnToColor(chess.turn());
    assertOrThrow(player.color === activeColor, 409, "It is not your turn.");

    if (!this.tickActiveClock(match, player)) {
      this.notify(match);
      return match;
    }

    const startingFen = match.chess.fen;
    const startingState = parseFenState(startingFen);
    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      move = null;
    }

    let fenAfter;
    let san;
    let mineTriggered = null;
    let moveKind = "standard";

    if (move) {
      const mined = applyMineToFen(match, player, chess.fen(), to, { consumeMine: true });
      fenAfter = mined.fen;
      mineTriggered = mined.mineTriggered;
      san = formatMineSan(move.san, mineTriggered);
      assertOrThrow(
        mineTriggered?.pieceType === "king" || !isKingInCheck(match, fenAfter, player.color),
        400,
        "Illegal chess move."
      );
    } else {
      assertOrThrow(isExtraMovePattern(player, startingState.board, from, to), 400, "Illegal chess move.");
      const applied = applyBoardMove(match, player, startingFen, { from, to, promotion }, { consumeMine: true });
      assertOrThrow(
        applied.mineTriggered?.pieceType === "king" || !isKingInCheck(match, applied.fen, player.color),
        400,
        "Illegal chess move."
      );
      fenAfter = applied.fen;
      san = applied.san;
      mineTriggered = applied.mineTriggered;
      moveKind = "powerup";
    }

    this.applyMoveTimeRecovery(player);
    match.chess.fen = fenAfter;
    match.chess.moves.push({
      userId,
      san,
      from,
      to,
      promotion,
      kind: moveKind,
      mineTriggered,
      fen: match.chess.fen,
      createdAt: nowIso()
    });

    if (mineTriggered?.pieceType === "king") {
      clearTurnPowerups(player);
      const opponent = getOpponent(match, userId);
      this.finishMatch(match, opponent?.userId ?? null, "mine");
      this.notify(match);
      return match;
    }

    this.finishChessTurn(match, player, fenAfter);
    this.notify(match);
    return match;
  }

  swapPieces(matchId, userId, { from, to }) {
    const match = this.getMatch(matchId);
    assertOrThrow(match.phase === PHASES.CHESS, 409, "Piece swaps are only available during chess.");
    assertOrThrow(isSquare(from) && isSquare(to), 400, "Swap squares must be valid chess coordinates.");
    assertOrThrow(from !== to, 400, "Choose two different pieces to swap.");

    const player = getPlayer(match, userId);
    const item = POWERUP_SHOP.pieceSwap;
    assertOrThrow(item, 400, "Unknown powerup.");
    assertOrThrow(player.powerups.includes("pieceSwap"), 400, "You do not own Tactical Swap.");
    assertOrThrow(!player.usedPowerups.includes("pieceSwap"), 409, "You have already used this powerup.");

    const state = parseFenState(match.chess.fen);
    assertOrThrow(state.turn === colorToTurn(player.color), 409, "It is not your turn.");

    if (!this.tickActiveClock(match, player)) {
      this.notify(match);
      return match;
    }

    const firstPiece = state.board.get(from);
    const secondPiece = state.board.get(to);
    assertOrThrow(firstPiece?.color === player.color && secondPiece?.color === player.color, 400, "Choose two of your own pieces.");

    state.board.set(from, secondPiece);
    state.board.set(to, firstPiece);
    const mineTriggers = [
      applyMineToState(match, player, state, from, { consumeMine: true }),
      applyMineToState(match, player, state, to, { consumeMine: true })
    ].filter(Boolean);

    const fenAfter = buildFenFromState(state.board, {
      turn: colorToTurn(otherColor(player.color)),
      halfmove: firstPiece.pieceType === "pawn" || secondPiece.pieceType === "pawn" || mineTriggers.length > 0 ? 0 : state.halfmove + 1,
      fullmove: player.color === COLORS.BLACK ? state.fullmove + 1 : state.fullmove
    });
    assertOrThrow(
      mineTriggers.some((mine) => mine.pieceType === "king") || !isKingInCheck(match, fenAfter, player.color),
      400,
      "Swap would leave your king in check."
    );

    player.usedPowerups.push("pieceSwap");
    this.applyMoveTimeRecovery(player);
    match.chess.fen = fenAfter;
    match.chess.moves.push({
      userId,
      san: `Swap ${PIECE_SAN[firstPiece.pieceType] || "P"}${from}<->${PIECE_SAN[secondPiece.pieceType] || "P"}${to}`,
      from,
      to,
      powerupId: "pieceSwap",
      kind: "powerup",
      mineTriggered: mineTriggers[0] ?? null,
      fen: match.chess.fen,
      createdAt: nowIso()
    });

    if (mineTriggers.some((mine) => mine.pieceType === "king")) {
      clearTurnPowerups(player);
      const opponent = getOpponent(match, userId);
      this.finishMatch(match, opponent?.userId ?? null, "mine");
      this.notify(match);
      return match;
    }

    this.finishChessTurn(match, player, fenAfter);
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
    assertOrThrow(powerupId !== "pieceSwap", 400, "Tactical Swap requires two selected pieces.");
    assertOrThrow(player.powerups.includes(powerupId), 400, "You do not own this powerup.");
    assertOrThrow(!player.usedPowerups.includes(powerupId), 409, "You have already used this powerup.");

    if (TURN_POWERUPS.has(powerupId)) {
      const activeColor = turnToColor(new Chess(match.chess.fen).turn());
      assertOrThrow(player.color === activeColor, 409, "You can only activate this powerup on your turn.");
      assertOrThrow(!player.activePowerups.includes(powerupId), 409, "This powerup is already active.");

      player.usedPowerups.push(powerupId);
      player.activePowerups.push(powerupId);
      this.notify(match);
      return match;
    }

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
      player.activePowerups = [];
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

  serialize(match, viewerUserId = null) {
    const viewer = viewerUserId ? match.players.find((player) => player.userId === viewerUserId) : null;
    return {
      id: match.id,
      status: match.status,
      phase: match.phase,
      createdAt: match.createdAt,
      phaseStartedAt: match.phaseStartedAt,
      phaseEndsAt: match.phaseEndsAt,
      serverTime: nowIso(),
      players: match.players.map((player) => {
        const serialized = serializePlayer(player);
        if (viewerUserId && match.phase === PHASES.PLACEMENT && player.userId !== viewerUserId) {
          return { ...serialized, placedPieces: [] };
        }
        return serialized;
      }),
      chess: match.chess,
      legalMoves:
        viewer && match.phase === PHASES.CHESS && match.chess
          ? legalMoveMapForPlayer(match, viewer, match.chess.fen)
          : {},
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
