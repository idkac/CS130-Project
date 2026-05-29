export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
export const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

export const PIECE_LABELS = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  pawn: "P"
};

export const PIECE_SYMBOLS = {
  king:   { white: "♔", black: "♚" },
  queen:  { white: "♕", black: "♛" },
  rook:   { white: "♖", black: "♜" },
  bishop: { white: "♗", black: "♝" },
  knight: { white: "♘", black: "♞" },
  pawn:   { white: "♙", black: "♟" }
};

const FEN_TO_PIECE = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn"
};

export function boardSquares(color = "white") {
  const files = color === "black" ? [...FILES].reverse() : FILES;
  const ranks = color === "black" ? [...RANKS].reverse() : RANKS;
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
}

export function parseFen(fen) {
  if (!fen) {
    return {};
  }

  const [placement] = fen.split(" ");
  const board = {};
  const rows = placement.split("/");

  rows.forEach((row, rowIndex) => {
    const rank = 8 - rowIndex;
    let fileIndex = 0;

    for (const char of row) {
      if (Number.isInteger(Number(char)) && char !== "0") {
        fileIndex += Number(char);
      } else {
        const file = FILES[fileIndex];
        const color = char === char.toUpperCase() ? "white" : "black";
        const pieceType = FEN_TO_PIECE[char.toLowerCase()];
        board[`${file}${rank}`] = {
          color,
          pieceType,
          label: PIECE_LABELS[pieceType]
        };
        fileIndex += 1;
      }
    }
  });

  return board;
}

export function placementPieces(match) {
  const pieces = {};
  for (const player of match?.players ?? []) {
    for (const piece of player.placedPieces) {
      pieces[piece.square] = {
        color: player.color,
        pieceType: piece.pieceType,
        label: PIECE_LABELS[piece.pieceType]
      };
    }
  }
  return pieces;
}

export function remainingInventory(player) {
  const remaining = { ...(player?.inventory ?? {}) };
  for (const piece of player?.placedPieces ?? []) {
    remaining[piece.pieceType] = (remaining[piece.pieceType] ?? 0) - 1;
  }
  return remaining;
}

export function isPlacementSquare(player, pieceType, square) {
  if (!player || !pieceType || !square) {
    return false;
  }

  const rank = Number(square[1]);
  const expanded = player.powerups.includes("expandedDeployment");

  if (pieceType === "pawn") {
    if (player.color === "white") {
      return rank === 2 || (expanded && rank === 3);
    }
    return rank === 7 || (expanded && rank === 6);
  }

  if (player.color === "white") {
    return rank === 1 || rank === 2 || (expanded && rank === 3);
  }

  return rank === 8 || rank === 7 || (expanded && rank === 6);
}

export function currentTurn(fen) {
  if (!fen) {
    return "white";
  }
  return fen.split(" ")[1] === "b" ? "black" : "white";
}
