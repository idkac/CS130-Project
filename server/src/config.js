export const CLICK_PHASE_MS = Number(process.env.CLICK_PHASE_MS ?? 20000);
export const MAX_CLICKS_PER_SECOND = Number(process.env.MAX_CLICKS_PER_SECOND ?? 15);

export const PHASES = {
  WAITING: "waiting",
  CLICKING: "clicking",
  SHOP: "shop",
  PLACEMENT: "placement",
  CHESS: "chess",
  COMPLETE: "complete"
};

export const COLORS = {
  WHITE: "white",
  BLACK: "black"
};

export const INITIAL_INVENTORY = {
  king: 1,
  pawn: 4
};

export const PIECE_SHOP = {
  pawn: {
    id: "pawn",
    label: "Pawn",
    cost: 5,
    maxQuantity: 8
  },
  knight: {
    id: "knight",
    label: "Knight",
    cost: 25,
    maxQuantity: 4
  },
  bishop: {
    id: "bishop",
    label: "Bishop",
    cost: 25,
    maxQuantity: 4
  },
  rook: {
    id: "rook",
    label: "Rook",
    cost: 50,
    maxQuantity: 4
  },
  queen: {
    id: "queen",
    label: "Queen",
    cost: 150,
    maxQuantity: 1
  }
};

export const POWERUP_SHOP = {
  expandedDeployment: {
    id: "expandedDeployment",
    label: "Forward Deployment",
    cost: 40,
    maxQuantity: 1,
    description: "Unlock one extra placement rank for non-pawn pieces."
  }
};

export const PIECE_TO_FEN = {
  king: "k",
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
  pawn: "p"
};

export const PIECE_LABELS = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  pawn: "P"
};

export const DEFAULT_PLACEMENTS = {
  white: [
    { pieceType: "king", square: "e1" },
    { pieceType: "pawn", square: "c2" },
    { pieceType: "pawn", square: "d2" },
    { pieceType: "pawn", square: "e2" },
    { pieceType: "pawn", square: "f2" }
  ],
  black: [
    { pieceType: "king", square: "e8" },
    { pieceType: "pawn", square: "c7" },
    { pieceType: "pawn", square: "d7" },
    { pieceType: "pawn", square: "e7" },
    { pieceType: "pawn", square: "f7" }
  ]
};

