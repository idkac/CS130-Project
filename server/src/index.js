import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { Server as SocketServer } from "socket.io";
import { z } from "zod";
import {
  clearSession,
  createSession,
  getSession,
  hashPassword,
  requireAuth,
  sanitizeUser,
  verifyPassword
} from "./auth.js";
import { AppError } from "./errors.js";
import { GameManager } from "./gameEngine.js";
import { JsonStore } from "./store.js";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const port = Number(process.env.PORT ?? 4001);
const host = process.env.HOST ?? "127.0.0.1";
const clientOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: {
    origin: clientOrigins,
    credentials: true
  }
});

const store = new JsonStore();
await store.load();

const manager = new GameManager({
  onMatchChanged: (match) => {
    io.to(match.id).emit("match:update", manager.serialize(match));
  },
  onMatchCompleted: (record) => {
    store.recordCompletedMatch(record).catch((error) => {
      console.error("Failed to persist completed match", error);
    });
  }
});

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, "Username can only use letters, numbers, underscores, and dashes."),
  password: z.string().min(6).max(128)
});

const purchaseSchema = z.object({
  itemType: z.enum(["piece", "powerup"]),
  itemId: z.string().min(1)
});

const placePieceSchema = z.object({
  pieceType: z.string().min(1),
  square: z.string().min(2).max(2)
});

const moveSchema = z.object({
  from: z.string().min(2).max(2),
  to: z.string().min(2).max(2),
  promotion: z.string().min(1).max(1).optional()
});

const usePowerupSchema = z.object({
  powerupId: z.string().min(1)
});

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, result.error.issues.map((issue) => issue.message).join(" "));
  }
  return result.data;
}

function requireMatchAccess(match, userId) {
  if (!match.players.some((player) => player.userId === userId)) {
    throw new AppError(403, "You do not have access to this match.");
  }
}

if (process.env.NODE_ENV === "production") {
  app.use(helmet());
}
app.use(
  cors({
    origin: clientOrigins,
    credentials: true
  })
);
app.use(express.json());
app.use((req, _res, next) => {
  req.store = store;
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "clickmate-server"
  });
});

app.post(
  "/api/auth/register",
  asyncHandler(async (req, res) => {
    const { username, password } = parseBody(credentialsSchema, req.body);
    const existing = await store.getUserByUsername(username);
    if (existing) {
      throw new AppError(409, "Username is already taken.");
    }

    const user = await store.createUser({
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      wins: 0,
      losses: 0,
      createdAt: new Date().toISOString()
    });
    const token = createSession(user.id);

    res.status(201).json({
      token,
      user: sanitizeUser(user)
    });
  })
);

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const { username, password } = parseBody(credentialsSchema, req.body);
    const user = await store.getUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new AppError(401, "Invalid username or password.");
    }

    const token = createSession(user.id);
    res.json({
      token,
      user: sanitizeUser(user)
    });
  })
);

app.post(
  "/api/auth/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    clearSession(req.auth.token);
    res.status(204).end();
  })
);

app.get(
  "/api/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      user: req.auth.user
    });
  })
);

app.post(
  "/api/matchmaking/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = manager.joinMatchmaking(req.auth.user);
    res.status(201).json({
      match: manager.serialize(match)
    });
  })
);

app.get(
  "/api/matches/:matchId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = manager.getMatch(req.params.matchId);
    requireMatchAccess(match, req.auth.user.id);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.post(
  "/api/matches/:matchId/click",
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = manager.registerClick(req.params.matchId, req.auth.user.id);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.post(
  "/api/matches/:matchId/purchase",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = parseBody(purchaseSchema, req.body);
    const match = manager.purchase(req.params.matchId, req.auth.user.id, payload);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.post(
  "/api/matches/:matchId/place-piece",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = parseBody(placePieceSchema, req.body);
    const match = manager.placePiece(req.params.matchId, req.auth.user.id, payload);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.delete(
  "/api/matches/:matchId/place-piece/:square",
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = manager.removePiece(req.params.matchId, req.auth.user.id, req.params.square);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.post(
  "/api/matches/:matchId/ready",
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = manager.ready(req.params.matchId, req.auth.user.id);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.post(
  "/api/matches/:matchId/move",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = parseBody(moveSchema, req.body);
    const match = manager.submitMove(req.params.matchId, req.auth.user.id, payload);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.post(
  "/api/matches/:matchId/resign",
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = manager.resign(req.params.matchId, req.auth.user.id);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.post(
  "/api/matches/:matchId/use-powerup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = parseBody(usePowerupSchema, req.body);
    const match = manager.usePowerup(req.params.matchId, req.auth.user.id, payload);
    res.json({
      match: manager.serialize(match)
    });
  })
);

app.get(
  "/api/users/:userId/history",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.params.userId !== req.auth.user.id) {
      throw new AppError(403, "Users can only view their own match history in the MVP.");
    }

    const history = await store.getHistoryForUser(req.auth.user.id);
    res.json({
      user: sanitizeUser(history.user),
      matches: history.matches
    });
  })
);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const session = getSession(token);
    if (!session) {
      throw new AppError(401, "Socket authentication required.");
    }

    const user = await store.getUserById(session.userId);
    if (!user) {
      throw new AppError(401, "Socket session user not found.");
    }

    socket.user = sanitizeUser(user);
    next();
  } catch (error) {
    next(error);
  }
});

io.on("connection", (socket) => {
  socket.on("match:join", ({ matchId } = {}, reply) => {
    try {
      const match = manager.getMatch(matchId);
      requireMatchAccess(match, socket.user.id);
      socket.join(match.id);
      reply?.({
        ok: true,
        match: manager.serialize(match)
      });
    } catch (error) {
      reply?.({
        ok: false,
        error: error.message
      });
    }
  });
});

setInterval(() => {
  manager.advanceExpiredMatches();
}, 1000).unref();

app.use((req, _res, next) => {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`));
});

app.use((error, _req, res, _next) => {
  const status = error.status ?? 500;
  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    error: error.message ?? "Internal server error"
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use on ${host}. Stop the existing server or set PORT to another value.`
    );
    process.exit(1);
  }

  throw error;
});

server.listen(port, host, () => {
  console.log(`Clickmate server listening on http://${host}:${port}`);
});
