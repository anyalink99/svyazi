import type { Team, TurnRecord } from "./types.js";

export interface ClueMemory {
  clue: string;
  remaining: number;
}

export function clueRemaining(record: TurnRecord): number {
  return record.remaining ?? Math.max(
    0,
    record.number - record.guesses.filter((guess) => guess.role === record.team).length
  );
}

export function unresolvedClues(history: readonly TurnRecord[], team: Team): ClueMemory[] {
  return history
    .filter((record) => record.team === team)
    .map((record) => ({ clue: record.clue, remaining: clueRemaining(record) }))
    .filter((record) => record.remaining > 0);
}
