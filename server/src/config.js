export const CLICK_PHASE_MS = Number(process.env.CLICK_PHASE_MS ?? 20000);
export const MAX_CLICKS_PER_SECOND = Number(process.env.MAX_CLICKS_PER_SECOND ?? 15);
export const CHESS_CLOCK_MS = Number(process.env.CHESS_CLOCK_MS ?? 300000); // 5 minutes per player
export const CHESS_TIME_BONUS_MS = 30000; // +30s from timeBonus powerup
export const CHESS_TIME_PENALTY_MS = 20000; // -20s from timePenalty powerup
export const CHESS_TIME_RECOVER_MS = 5000; // +5s per move from moveTimeRecover powerup

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
  },
  timeBonus: {
    id: "timeBonus",
    label: "Time Boost",
    cost: 30,
    maxQuantity: 1,
    description: "Add 30 extra seconds to your chess clock."
  },
  timePenalty: {
    id: "timePenalty",
    label: "Time Drain",
    cost: 35,
    maxQuantity: 1,
    description: "Reduce your opponent's chess clock by 20 seconds."
  },
  moveTimeRecover: {
    id: "moveTimeRecover",
    label: "Time Recovery",
    cost: 50,
    maxQuantity: 1,
    description: "Each move you make adds 5 seconds back to your clock."
  },
  timeSiphon: {
    id: "timeSiphon",
    label: "Time Siphon",
    cost: 60,
    maxQuantity: 1,
    description: "Active: during chess, drain 30s from your opponent and gain 10s yourself. One use.",
    activatable: true
  }
};

export const TIME_SIPHON_DRAIN_MS = 30000;
export const TIME_SIPHON_GAIN_MS = 10000;

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