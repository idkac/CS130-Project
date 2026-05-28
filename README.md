# Clickmate

Clickmate is a CS130 prototype for the design doc idea "Cookie Clicker + Chess." It combines a timed clicking economy with a customized chess setup phase, then hands the final board to a server-validated chess game.

## MVP Scope

Implemented in this prototype:

- Account registration/login with local session tokens.
- File-backed local user records and completed match history.
- Two-player matchmaking through a shared local queue.
- Timed clicking phase with server-side click-rate validation.
- Shop phase for buying chess pieces, clock powerups, and strategic piece/placement powerups.
- Placement phase with server-side board-zone, inventory, expanded-rank, and mine validation.
- Chess phase with `chess.js` plus server-side powerup-aware move validation.
- Match completion through checkmate, draw, stalemate, or resignation.
- React UI for lobby, clicking, shop, placement, chess, and history.

Deferred from the full design doc:

- Redis/PostgreSQL infrastructure.
- Production authentication and persistent sessions.
- Ranked matchmaking, MMR, AI opponents, and production-only powerup balancing.
- Large-scale multiplayer deployment.

## Tech Stack

- Frontend: React, Vite, Tailwind CSS, Socket.IO client.
- Backend: Node.js, Express, Socket.IO, chess.js.
- Persistence: local JSON file for development (`server/data/db.json`).
- Tests: Node's built-in test runner for backend game rules.

## Prerequisites

- Node.js 20 or newer.
- npm 10 or newer.

This repo was verified with Node `v23.7.0` and npm `10.9.2`.

## Setup

Install dependencies from the repository root:

```bash
npm install
```

Optional environment setup:

```bash
cp .env.example .env
cp client/.env.example client/.env
```

The defaults are enough for local development:

- Backend: `http://127.0.0.1:4001`
- Frontend: `http://127.0.0.1:5173`

## Run Locally

Start both the backend and frontend:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:server
npm run dev:client
```

Open the frontend at:

```text
http://127.0.0.1:5173/
```

If `npm run dev` reports `EADDRINUSE`, another copy of the dev server is already running on that port. Stop the old process, then rerun `npm run dev`:

```bash
lsof -tiTCP:4001 -sTCP:LISTEN
lsof -tiTCP:5173 -sTCP:LISTEN
kill <pid>
```

To test a full match locally, register two users in two browser sessions or in one normal window plus one private/incognito window. Both users should click `Join match`; the second join starts the timed clicking phase.

## Scripts

```bash
npm test        # backend game-engine tests
npm run build   # production frontend build
npm start       # start backend server
```

## Gameplay Flow

1. Register or log in.
2. Join matchmaking.
3. Click during the timed phase to earn pawn currency.
4. Spend pawns on pieces or powerups.
5. Ready up for placement.
6. Place pieces on your allowed ranks and place mines if purchased.
7. Ready up to start chess.
8. Play legal chess moves and active powerups until the game ends or a player resigns.

The backend is the source of truth for clicks, purchases, placements, moves, phase transitions, and match results.

## Project Structure

```text
client/
  src/
    App.jsx       React application and phase views
    api.js        API and Socket.IO endpoint configuration
    board.js      Board parsing and placement helpers
server/
  src/
    index.js      Express API and Socket.IO server
    gameEngine.js Match phases, economy, placement, and chess rules
    auth.js       Password hashing and in-memory sessions
    store.js      Local JSON persistence
  test/
    gameEngine.test.js
```

## API Surface

The MVP includes the design-doc API shape with `/api` prefixed routes:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/matchmaking/join`
- `POST /api/matches/:matchId/click`
- `POST /api/matches/:matchId/purchase`
- `POST /api/matches/:matchId/place-piece`
- `DELETE /api/matches/:matchId/place-piece/:square`
- `POST /api/matches/:matchId/block-square`
- `DELETE /api/matches/:matchId/block-square/:square`
- `POST /api/matches/:matchId/ready`
- `POST /api/matches/:matchId/move`
- `POST /api/matches/:matchId/swap-pieces`
- `POST /api/matches/:matchId/use-powerup`
- `POST /api/matches/:matchId/resign`
- `GET /api/matches/:matchId`
- `GET /api/users/:userId/history`

Socket.IO broadcasts `match:update` events to clients in the active match room.

## Development Notes

- `server/data/db.json` is generated at runtime and intentionally ignored by git.
- Active matches are in memory, so restarting the backend clears live matches.
- Completed match history and user win/loss records persist locally.
- Server-side validation should remain the authority for any new economy, placement, or chess feature.
- If Redis/PostgreSQL are added later, keep `GameManager` focused on match rules and move persistence behind a store/service boundary.
