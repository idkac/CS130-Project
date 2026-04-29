import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { apiFetch, SOCKET_URL } from "./api.js";
import {
  PIECE_LABELS,
  boardSquares,
  currentTurn,
  isPlacementSquare,
  parseFen,
  placementPieces,
  remainingInventory
} from "./board.js";

const STORED_TOKEN = "clickmate:token";
const STORED_USER = "clickmate:user";
const PIECE_ORDER = ["king", "queen", "rook", "bishop", "knight", "pawn"];

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(STORED_USER));
  } catch {
    return null;
  }
}

function formatPhase(phase) {
  return phase.replace("_", " ");
}

function shortId(id) {
  return id ? id.slice(0, 8) : "";
}

function useNow(intervalMs = 250) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function secondsLeft(match, now) {
  if (!match?.phaseEndsAt) {
    return null;
  }

  return Math.max(0, Math.ceil((new Date(match.phaseEndsAt).getTime() - now) / 1000));
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(STORED_TOKEN));
  const [user, setUser] = useState(readStoredUser);
  const [match, setMatch] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const now = useNow();

  const me = useMemo(
    () => match?.players.find((player) => player.userId === user?.id) ?? null,
    [match, user]
  );
  const opponent = useMemo(
    () => match?.players.find((player) => player.userId !== user?.id) ?? null,
    [match, user]
  );

  const authedFetch = useCallback(
    (path, options = {}) => apiFetch(path, { ...options, token }),
    [token]
  );

  const refreshHistory = useCallback(async () => {
    if (!token || !user?.id) {
      return;
    }

    const payload = await apiFetch(`/users/${user.id}/history`, { token });
    setHistory(payload.matches);
    setUser(payload.user);
    localStorage.setItem(STORED_USER, JSON.stringify(payload.user));
  }, [token, user?.id]);

  useEffect(() => {
    if (!token || !match?.id) {
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      auth: { token }
    });

    socket.on("connect", () => {
      socket.emit("match:join", { matchId: match.id }, (reply) => {
        if (reply?.ok && reply.match) {
          setMatch(reply.match);
        } else if (reply?.error) {
          setError(reply.error);
        }
      });
    });

    socket.on("match:update", (updatedMatch) => {
      setMatch(updatedMatch);
    });

    socket.on("connect_error", (socketError) => {
      setError(socketError.message);
    });

    return () => socket.disconnect();
  }, [token, match?.id]);

  useEffect(() => {
    setSelectedPiece(null);
    setSelectedSquare(null);
  }, [match?.phase]);

  useEffect(() => {
    if (token && user?.id) {
      refreshHistory().catch((historyError) => setError(historyError.message));
    }
  }, [token, user?.id, refreshHistory]);

  useEffect(() => {
    if (match?.phase === "complete") {
      refreshHistory().catch((historyError) => setError(historyError.message));
    }
  }, [match?.phase, refreshHistory]);

  async function handleAuth(mode, credentials) {
    setError("");
    const payload = await apiFetch(`/auth/${mode}`, {
      method: "POST",
      body: credentials
    });
    setToken(payload.token);
    setUser(payload.user);
    localStorage.setItem(STORED_TOKEN, payload.token);
    localStorage.setItem(STORED_USER, JSON.stringify(payload.user));
  }

  async function logout() {
    setError("");
    try {
      await authedFetch("/auth/logout", { method: "POST" });
    } finally {
      setToken(null);
      setUser(null);
      setMatch(null);
      setHistory([]);
      localStorage.removeItem(STORED_TOKEN);
      localStorage.removeItem(STORED_USER);
    }
  }

  async function joinMatchmaking() {
    try {
      setError("");
      const payload = await authedFetch("/matchmaking/join", { method: "POST" });
      setMatch(payload.match);
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function matchAction(path, { method = "POST", body } = {}) {
    if (!match) {
      return;
    }

    try {
      setError("");
      const payload = await authedFetch(`/matches/${match.id}${path}`, {
        method,
        body
      });
      setMatch(payload.match);
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  const phaseSecondsLeft = secondsLeft(match, now);

  return (
    <div className="min-h-screen bg-[#f7f4ee] text-ink">
      <header className="border-b border-black/10 bg-white/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Clickmate</h1>
            <p className="text-sm text-ink/65">Cookie clicking economy, custom chess setup.</p>
          </div>
          {user ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden sm:inline">
                {user.username} ({user.wins}-{user.losses})
              </span>
              <button className="rounded-md border border-black/15 px-3 py-2" onClick={logout}>
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          {error ? <ErrorBanner message={error} onClose={() => setError("")} /> : null}

          {!user ? (
            <AuthPanel onSubmit={handleAuth} onError={setError} />
          ) : (
            <div className="space-y-4">
              <PhaseHeader match={match} secondsLeft={phaseSecondsLeft} me={me} opponent={opponent} />
              <PhaseView
                match={match}
                me={me}
                opponent={opponent}
                selectedPiece={selectedPiece}
                selectedSquare={selectedSquare}
                onSelectPiece={setSelectedPiece}
                onSelectSquare={setSelectedSquare}
                onJoinMatchmaking={joinMatchmaking}
                onAction={matchAction}
              />
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <PlayerPanel user={user} match={match} me={me} opponent={opponent} />
          <HistoryPanel history={history} userId={user?.id} />
        </aside>
      </main>
    </div>
  );
}

function ErrorBanner({ message, onClose }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span>{message}</span>
      <button className="rounded-md px-2 py-1 text-red-900 hover:bg-red-100" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}

function AuthPanel({ onSubmit, onError }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit(mode, { username, password });
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="max-w-md rounded-md border border-black/10 bg-white p-4 shadow-sm" onSubmit={submit}>
      <div className="mb-4 flex rounded-md border border-black/10 bg-black/[0.03] p-1">
        {["login", "register"].map((option) => (
          <button
            className={`flex-1 rounded px-3 py-2 text-sm font-medium ${
              mode === option ? "bg-white shadow-sm" : "text-ink/65"
            }`}
            key={option}
            type="button"
            onClick={() => setMode(option)}
          >
            {option === "login" ? "Log in" : "Register"}
          </button>
        ))}
      </div>

      <label className="mb-3 block text-sm font-medium">
        Username
        <input
          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 outline-none focus:border-accent"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
        />
      </label>

      <label className="mb-4 block text-sm font-medium">
        Password
        <input
          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 outline-none focus:border-accent"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </label>

      <button
        className="w-full rounded-md bg-accent px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-black/25"
        disabled={busy}
      >
        {mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}

function PhaseHeader({ match, secondsLeft: timeLeft, me, opponent }) {
  if (!match) {
    return (
      <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-normal text-ink/55">Lobby</p>
        <h2 className="text-xl font-semibold">No active match</h2>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-normal text-ink/55">
            Match {shortId(match.id)}
          </p>
          <h2 className="text-xl font-semibold capitalize">{formatPhase(match.phase)}</h2>
        </div>
        <div className="flex gap-2 text-sm">
          {timeLeft !== null ? <Metric label="Timer" value={`${timeLeft}s`} /> : null}
          {me ? <Metric label="Pawns" value={me.pawnCount} /> : null}
          {opponent ? <Metric label="Opponent" value={opponent.username} /> : <Metric label="Opponent" value="Waiting" />}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-md border border-black/10 bg-[#f7f4ee] px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-normal text-ink/50">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function PhaseView(props) {
  const { match, me, onJoinMatchmaking } = props;

  if (!match || match.phase === "complete") {
    return <LobbyOrSummary {...props} />;
  }

  if (match.phase === "waiting") {
    return <WaitingPhase match={match} />;
  }

  if (match.phase === "clicking") {
    return <ClickingPhase me={me} onAction={props.onAction} />;
  }

  if (match.phase === "shop") {
    return <ShopPhase match={match} me={me} onAction={props.onAction} />;
  }

  if (match.phase === "placement") {
    return <PlacementPhase {...props} />;
  }

  if (match.phase === "chess") {
    return <ChessPhase {...props} />;
  }

  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <button className="rounded-md bg-accent px-4 py-2 font-semibold text-white" onClick={onJoinMatchmaking}>
        Join match
      </button>
    </div>
  );
}

function LobbyOrSummary({ match, me, opponent, onJoinMatchmaking }) {
  if (match?.phase === "complete") {
    const winner =
      match.winnerId === me?.userId ? me?.username : match.winnerId === opponent?.userId ? opponent?.username : null;

    return (
      <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-lg font-semibold">Match complete</h3>
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
          <Metric label="Result" value={winner ? `${winner} won` : "Draw"} />
          <Metric label="Reason" value={match.resultReason ?? "complete"} />
          <Metric label="Moves" value={match.chess?.moves.length ?? 0} />
        </div>
        <button className="rounded-md bg-accent px-4 py-2 font-semibold text-white" onClick={onJoinMatchmaking}>
          New match
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Quick match</h3>
          <p className="text-sm text-ink/65">Two browser sessions can join the same local queue.</p>
        </div>
        <button className="rounded-md bg-accent px-4 py-2 font-semibold text-white" onClick={onJoinMatchmaking}>
          Join match
        </button>
      </div>
    </div>
  );
}

function WaitingPhase({ match }) {
  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold">Queue</h3>
      <p className="mt-1 text-sm text-ink/65">Match {shortId(match.id)} is open.</p>
    </div>
  );
}

function ClickingPhase({ me, onAction }) {
  const [pending, setPending] = useState(0);

  async function click() {
    setPending((count) => count + 1);
    try {
      await onAction("/click");
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }

  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <div className="grid items-center gap-4 md:grid-cols-[1fr_220px]">
        <button
          className="min-h-48 rounded-md border border-black/10 bg-accent text-3xl font-bold text-white shadow-sm active:translate-y-px"
          onClick={click}
        >
          Click
        </button>
        <div className="space-y-3">
          <Metric label="Your pawns" value={me?.pawnCount ?? 0} />
          <Metric label="Clicks" value={me?.totalClicks ?? 0} />
          <Metric label="Pending" value={pending} />
        </div>
      </div>
    </div>
  );
}

function ShopPhase({ match, me, onAction }) {
  const inventory = me?.inventory ?? {};
  const powerups = me?.powerups ?? [];

  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Shop</h3>
        <button
          className="rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-black/25"
          disabled={me?.ready}
          onClick={() => onAction("/ready")}
        >
          {me?.ready ? "Ready" : "Ready up"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StoreList
          title="Pieces"
          items={match.shop.pieces}
          owned={(item) => inventory[item.id] ?? 0}
          disabled={(item) => me?.pawnCount < item.cost || me?.ready}
          onBuy={(item) => onAction("/purchase", { body: { itemType: "piece", itemId: item.id } })}
        />
        <StoreList
          title="Powerups"
          items={match.shop.powerups}
          owned={(item) => powerups.filter((powerup) => powerup === item.id).length}
          disabled={(item) => me?.pawnCount < item.cost || me?.ready}
          onBuy={(item) => onAction("/purchase", { body: { itemType: "powerup", itemId: item.id } })}
        />
      </div>
    </div>
  );
}

function StoreList({ title, items, owned, disabled, onBuy }) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold uppercase tracking-normal text-ink/55">{title}</h4>
      <div className="divide-y divide-black/10 rounded-md border border-black/10">
        {items.map((item) => (
          <div className="flex items-center justify-between gap-3 p-3" key={item.id}>
            <div className="min-w-0">
              <div className="font-semibold">{item.label}</div>
              <div className="text-sm text-ink/60">
                {item.cost} pawns | owned {owned(item)}
              </div>
            </div>
            <button
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-black/25"
              disabled={disabled(item)}
              onClick={() => onBuy(item)}
            >
              Buy
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlacementPhase({
  match,
  me,
  selectedPiece,
  onSelectPiece,
  selectedSquare,
  onSelectSquare,
  onAction
}) {
  const remaining = remainingInventory(me);
  const pieces = placementPieces(match);
  const hasKing = me?.placedPieces.some((piece) => piece.pieceType === "king");

  async function handleSquare(square) {
    const piece = pieces[square];
    onSelectSquare(square);

    if (piece?.color === me?.color) {
      await onAction(`/place-piece/${square}`, { method: "DELETE" });
      return;
    }

    if (selectedPiece) {
      await onAction("/place-piece", {
        body: {
          pieceType: selectedPiece,
          square
        }
      });
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
        <GameBoard
          mode="placement"
          me={me}
          pieces={pieces}
          selectedPiece={selectedPiece}
          selectedSquare={selectedSquare}
          onSquareClick={handleSquare}
        />
      </div>

      <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-lg font-semibold">Placement</h3>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {PIECE_ORDER.filter((pieceType) => (remaining[pieceType] ?? 0) > 0).map((pieceType) => (
            <button
              className={`rounded-md border px-3 py-2 font-semibold ${
                selectedPiece === pieceType
                  ? "border-accent bg-accent text-white"
                  : "border-black/10 bg-[#f7f4ee]"
              }`}
              key={pieceType}
              onClick={() => onSelectPiece(pieceType)}
            >
              {PIECE_LABELS[pieceType]} x{remaining[pieceType]}
            </button>
          ))}
        </div>
        <button
          className="w-full rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-black/25"
          disabled={!hasKing || me?.ready}
          onClick={() => onAction("/ready")}
        >
          {me?.ready ? "Ready" : "Ready up"}
        </button>
      </div>
    </div>
  );
}

function ChessPhase({ match, me, selectedSquare, onSelectSquare, onAction }) {
  const pieces = parseFen(match.chess?.fen);
  const turn = currentTurn(match.chess?.fen);
  const isMyTurn = turn === me?.color;

  async function handleSquare(square) {
    const piece = pieces[square];

    if (!selectedSquare) {
      if (piece?.color === me?.color && isMyTurn) {
        onSelectSquare(square);
      }
      return;
    }

    if (selectedSquare === square) {
      onSelectSquare(null);
      return;
    }

    if (piece?.color === me?.color) {
      onSelectSquare(square);
      return;
    }

    await onAction("/move", {
      body: {
        from: selectedSquare,
        to: square,
        promotion: "q"
      }
    });
    onSelectSquare(null);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
        <GameBoard
          mode="chess"
          me={me}
          pieces={pieces}
          selectedSquare={selectedSquare}
          onSquareClick={handleSquare}
        />
      </div>

      <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-lg font-semibold">Chess</h3>
        <div className="mb-3 space-y-2 text-sm">
          <Metric label="Turn" value={turn} />
          <Metric label="Moves" value={match.chess?.moves.length ?? 0} />
        </div>
        <button className="mb-4 w-full rounded-md border border-black/15 px-4 py-2" onClick={() => onAction("/resign")}>
          Resign
        </button>
        <ol className="max-h-80 space-y-1 overflow-auto text-sm">
          {[...(match.chess?.moves ?? [])].reverse().map((move, index) => (
            <li className="rounded-md bg-[#f7f4ee] px-2 py-1" key={`${move.createdAt}-${index}`}>
              {move.san}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function GameBoard({ me, pieces, selectedPiece, selectedSquare, onSquareClick }) {
  const squares = boardSquares(me?.color);

  return (
    <div className="mx-auto grid aspect-square w-full max-w-[640px] grid-cols-8 overflow-hidden rounded-md border border-black/20">
      {squares.map((square) => {
        const fileIndex = square.charCodeAt(0) - "a".charCodeAt(0);
        const rank = Number(square[1]);
        const dark = (fileIndex + rank) % 2 === 1;
        const piece = pieces[square];
        const selected = selectedSquare === square;
        const placeable = selectedPiece && isPlacementSquare(me, selectedPiece, square) && !piece;

        return (
          <button
            className={`relative flex min-h-10 items-center justify-center ${
              dark ? "bg-boardDark" : "bg-boardLight"
            } ${selected ? "ring-4 ring-accent ring-inset" : ""} ${placeable ? "outline outline-2 outline-white/80" : ""}`}
            key={square}
            onClick={() => onSquareClick(square)}
          >
            <span className="absolute left-1 top-0.5 text-[10px] font-semibold text-black/45">{square}</span>
            {piece ? (
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-md border text-xl font-bold shadow-sm ${
                  piece.color === "white"
                    ? "border-black/20 bg-white text-ink"
                    : "border-white/25 bg-ink text-white"
                }`}
              >
                {piece.label}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function PlayerPanel({ user, match, me, opponent }) {
  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-lg font-semibold">Players</h3>
      {user ? (
        <div className="space-y-2 text-sm">
          <PlayerRow label="You" player={me ?? { username: user.username, color: "-", pawnCount: 0 }} />
          <PlayerRow label="Opponent" player={opponent} />
          {match ? <Metric label="Match" value={shortId(match.id)} /> : null}
        </div>
      ) : (
        <p className="text-sm text-ink/65">No active session.</p>
      )}
    </div>
  );
}

function PlayerRow({ label, player }) {
  return (
    <div className="rounded-md border border-black/10 bg-[#f7f4ee] px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-normal text-ink/50">{label}</div>
      <div className="font-semibold">{player?.username ?? "Waiting"}</div>
      <div className="text-xs text-ink/60">
        {player?.color ?? "-"} | {player?.pawnCount ?? 0} pawns
      </div>
    </div>
  );
}

function HistoryPanel({ history, userId }) {
  return (
    <div className="rounded-md border border-black/10 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-lg font-semibold">History</h3>
      {history.length === 0 ? (
        <p className="text-sm text-ink/65">No completed matches.</p>
      ) : (
        <div className="space-y-2">
          {history.slice(0, 8).map((match) => {
            const result = match.winnerId ? (match.winnerId === userId ? "Win" : "Loss") : "Draw";
            return (
              <div className="rounded-md border border-black/10 bg-[#f7f4ee] px-3 py-2 text-sm" key={match.id}>
                <div className="font-semibold">
                  {result} by {match.resultReason}
                </div>
                <div className="text-ink/60">
                  {match.moveCount} moves | {shortId(match.id)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
