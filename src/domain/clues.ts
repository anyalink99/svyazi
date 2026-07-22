import type { GameState, Team, TurnRecord } from "./types.js";

export interface ClueMemory {
  clue: string;
  remaining: number;
}

export function clueRemaining(record: TurnRecord): number {
  return record.remaining ?? record.number;
}

export function unresolvedClues(history: readonly TurnRecord[], team: Team): ClueMemory[] {
  return history
    .filter((record) => record.team === team)
    .map((record) => ({ clue: record.clue, remaining: clueRemaining(record) }))
    .filter((record) => record.remaining > 0);
}

export function refreshTrackedClueRemainders(state: GameState, team: Team): GameState {
  const openWords = new Set(state.cards.filter((card) => !card.revealed).map((card) => card.word));
  return {
    ...state,
    history: state.history.map((record) => {
      if (record.team !== team || record.targetWords.length === 0) return record;
      const targets = [...new Set(record.targetWords.slice(0, record.number))];
      return {
        ...record,
        remaining: Math.min(record.number, targets.filter((word) => openWords.has(word)).length)
      };
    })
  };
}
