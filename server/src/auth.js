import crypto from "node:crypto";
import { AppError } from "./errors.js";

const sessions = new Map();

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const computed = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, "hex");
  return stored.length === computed.length && crypto.timingSafeEqual(stored, computed);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, createdAt: new Date().toISOString() });
  return token;
}

export function getSession(token) {
  if (!token) {
    return null;
  }
  return sessions.get(token) ?? null;
}

export function clearSession(token) {
  sessions.delete(token);
}

export async function requireAuth(req, _res, next) {
  try {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const session = getSession(token);

    if (!session) {
      throw new AppError(401, "Authentication required.");
    }

    const user = await req.store.getUserById(session.userId);
    if (!user) {
      throw new AppError(401, "Session user no longer exists.");
    }

    req.auth = {
      token,
      user: sanitizeUser(user)
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    wins: user.wins,
    losses: user.losses,
    createdAt: user.createdAt
  };
}

