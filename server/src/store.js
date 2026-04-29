import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeUsername } from "./auth.js";

const defaultDataFile = fileURLToPath(new URL("../data/db.json", import.meta.url));

function createEmptyDb() {
  return {
    users: [],
    matches: []
  };
}

export class JsonStore {
  constructor(dataFile = process.env.DATA_FILE ?? defaultDataFile) {
    this.dataFile = dataFile;
    this.db = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.db) {
      return this.db;
    }

    try {
      const raw = await fs.readFile(this.dataFile, "utf8");
      this.db = JSON.parse(raw);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.db = createEmptyDb();
      await this.save();
    }

    this.db.users ??= [];
    this.db.matches ??= [];
    return this.db;
  }

  async save() {
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    const payload = JSON.stringify(this.db ?? createEmptyDb(), null, 2);
    this.writeQueue = this.writeQueue.then(() => fs.writeFile(this.dataFile, payload));
    return this.writeQueue;
  }

  async getUserById(userId) {
    const db = await this.load();
    return db.users.find((user) => user.id === userId) ?? null;
  }

  async getUserByUsername(username) {
    const db = await this.load();
    const normalized = normalizeUsername(username);
    return db.users.find((user) => normalizeUsername(user.username) === normalized) ?? null;
  }

  async createUser(user) {
    const db = await this.load();
    db.users.push(user);
    await this.save();
    return user;
  }

  async updateUser(userId, updater) {
    const db = await this.load();
    const index = db.users.findIndex((user) => user.id === userId);
    if (index === -1) {
      return null;
    }

    const updated = {
      ...db.users[index],
      ...updater(db.users[index])
    };
    db.users[index] = updated;
    await this.save();
    return updated;
  }

  async recordCompletedMatch(record) {
    const db = await this.load();
    const existingIndex = db.matches.findIndex((match) => match.id === record.id);
    if (existingIndex >= 0) {
      db.matches[existingIndex] = record;
    } else {
      db.matches.push(record);
    }

    if (record.winnerId) {
      for (const playerId of record.playerIds) {
        await this.updateUser(playerId, (user) => ({
          wins: user.wins + (playerId === record.winnerId ? 1 : 0),
          losses: user.losses + (playerId === record.winnerId ? 0 : 1)
        }));
      }
    }

    await this.load();
    await this.save();
    return record;
  }

  async getHistoryForUser(userId) {
    const db = await this.load();
    const user = await this.getUserById(userId);
    const matches = db.matches
      .filter((match) => match.playerIds.includes(userId))
      .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

    return {
      user,
      matches
    };
  }
}

