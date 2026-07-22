export type Team = "red" | "blue";
export type CardRole = Team | "neutral" | "assassin";
export type OperativeProfile = "cautious" | "balanced" | "daring";

export interface CardState {
  word: string;
  role: CardRole;
  revealed: boolean;
}

export interface RankedCard {
  index: number;
  word: string;
  similarity: number;
  noisyScore?: number;
  rank: number;
  role?: CardRole;
}

export interface ClueAnalysis {
  word: string;
  number: number;
  score: number;
  confidence: number;
  margin: number;
  targetWords: string[];
  strongestDanger: string | null;
  candidateCount: number;
  rankings: RankedCard[];
}

export interface GuessPlan {
  clue: string;
  number: number;
  profile: OperativeProfile;
  picks: RankedCard[];
  stoppedEarly: boolean;
  stopReason: string | null;
}

export interface RevealedGuess {
  index: number;
  word: string;
  role: CardRole;
  similarity: number;
}

export interface TurnRecord {
  turn: number;
  team: Team;
  clue: string;
  number: number;
  targetWords: string[];
  guesses: RevealedGuess[];
  endedBy: "limit" | "wrong-card" | "assassin" | "victory" | "stopped";
}

export interface GameState {
  id: string;
  seed: number;
  cards: CardState[];
  turn: Team;
  startingTeam: Team;
  turnNumber: number;
  winner: Team | null;
  history: TurnRecord[];
}

export interface SemanticMetadata {
  kind: "navec" | "demo";
  source: string;
  dimension: number;
  vocabularySize: number;
  boardWordCount: number;
  neighborsPerBoardWord: number;
  generatedAt?: string;
}

export interface SimulationSummary {
  games: number;
  seed: number;
  redWins: number;
  blueWins: number;
  assassinFinishes: number;
  averageTurns: number;
  averageClueNumber: number;
  averageCorrectPerTurn: number;
  clueNumberDistribution: Record<string, number>;
  durationMs: number;
}
