import type { GamePhase } from "../components/TurnPanel.js";
import type { AiTuning, TeamSeats } from "./multiplayer.js";
import type { ClueAnalysis, GameState, GuessPlan, TurnRecord } from "./types.js";

const STORAGE_KEY = "svyazi:session:v1";

export interface PersistedSession {
  game: GameState;
  turnBase: GameState | null;
  phase: GamePhase;
  seats: TeamSeats;
  tuning: AiTuning;
  localSeatId: string | null;
  clue: ClueAnalysis | null;
  lastPlan: GuessPlan | null;
  lastRecord: TurnRecord | null;
  pickedIndices: number[];
  votes: Record<string, number>;
  voteCursor: number;
  voteMessage: string | null;
  manualClue: string;
  manualNumber: number;
  remainingDraft: Record<string, number>;
  showTrace: boolean;
  showKey: boolean;
  autoPlay: boolean;
}

export function loadSession(): PersistedSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (!parsed.game || !Array.isArray(parsed.game.cards) || parsed.game.cards.length !== 25) return null;
    if (!parsed.seats?.red?.spymaster || !parsed.seats?.blue?.spymaster) return null;
    if (!parsed.tuning?.red || !parsed.tuning?.blue) return null;
    if (!(["clue", "guess", "result"] as string[]).includes(parsed.phase ?? "")) return null;
    return parsed as PersistedSession;
  } catch {
    return null;
  }
}

export function saveSession(session: PersistedSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A private browser window may deny storage; the game remains playable in memory.
  }
}
