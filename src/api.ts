import type {
  ClueAnalysis,
  GameState,
  GuessPlan,
  OperativeProfile,
  RevealedGuess,
  SemanticMetadata,
  SimulationSummary
} from "./domain/types.js";
import type { GameRoom } from "./domain/multiplayer.js";

export interface ApiStatus {
  ok: true;
  model: SemanticMetadata;
  modes: string[];
}

export interface TurnResult {
  state: GameState;
  clue: ClueAnalysis;
  plan: GuessPlan;
  revealed: RevealedGuess[];
}

export interface ResolveResult {
  state: GameState;
  clue: ClueAnalysis;
  revealed: RevealedGuess[];
  record: GameState["history"][number];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Ошибка API: ${response.status}`);
  return payload;
}

export const api = {
  status: () => request<ApiStatus>("/api/status"),
  newGame: (seed?: number, startingTeam?: "red" | "blue") =>
    request<GameState>("/api/games", {
      method: "POST",
      body: JSON.stringify({
        ...(seed === undefined ? {} : { seed }),
        ...(startingTeam === undefined ? {} : { startingTeam })
      })
    }),
  clue: (state: GameState, maxNumber = 4) =>
    request<ClueAnalysis>("/api/clues", {
      method: "POST",
      body: JSON.stringify({ state, maxNumber })
    }),
  analyzeClue: (state: GameState, clue: string, number: number) =>
    request<ClueAnalysis>("/api/clues/analyze", {
      method: "POST",
      body: JSON.stringify({ state, clue, number })
    }),
  guesses: (state: GameState, clue: string, number: number, profile: OperativeProfile) =>
    request<GuessPlan>("/api/guesses", {
      method: "POST",
      body: JSON.stringify({ state, clue, number, profile })
    }),
  turn: (
    state: GameState,
    profile: OperativeProfile,
    provided?: { clue: string; number: number }
  ) =>
    request<TurnResult>("/api/turns", {
      method: "POST",
      body: JSON.stringify({
        state,
        profile,
        clue: provided?.clue,
        number: provided?.number
      })
    }),
  resolveTurn: (
    state: GameState,
    clue: string,
    number: number,
    picks: number[],
    stoppedEarly = false
  ) =>
    request<ResolveResult>("/api/turns/resolve", {
      method: "POST",
      body: JSON.stringify({ state, clue, number, picks, stoppedEarly })
    }),
  simulate: (games: number, redProfile: OperativeProfile, blueProfile: OperativeProfile) =>
    request<SimulationSummary>("/api/simulations", {
      method: "POST",
      body: JSON.stringify({ games, redProfile, blueProfile })
    }),
  createRoom: (hostName: string) =>
    request<GameRoom>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ hostName })
    }),
  room: (code: string) => request<GameRoom>(`/api/rooms/${encodeURIComponent(code)}`)
};
