import { makeSeed, mulberry32, shuffle } from "./random.js";
import type { CardRole, CardState, GameState, Team } from "./types.js";

export const BOARD_SIZE = 25;

export function otherTeam(team: Team): Team {
  return team === "red" ? "blue" : "red";
}

export function createGame(
  boardWords: readonly string[],
  requestedSeed = makeSeed(),
  forcedStartingTeam?: Team
): GameState {
  if (boardWords.length < BOARD_SIZE) {
    throw new Error(`Для партии нужно минимум ${BOARD_SIZE} слов.`);
  }

  const seed = requestedSeed >>> 0;
  const random = mulberry32(seed);
  const words = shuffle([...new Set(boardWords)], random).slice(0, BOARD_SIZE);
  if (words.length < BOARD_SIZE) {
    throw new Error("В словаре недостаточно уникальных слов для поля.");
  }

  const startingTeam = forcedStartingTeam ?? (random() < 0.5 ? "red" : "blue");
  const roles: CardRole[] = [
    ...Array.from({ length: 9 }, () => startingTeam),
    ...Array.from({ length: 8 }, () => otherTeam(startingTeam)),
    ...Array.from({ length: 7 }, () => "neutral" as const),
    "assassin"
  ];
  const shuffledRoles = shuffle(roles, random);
  const cards: CardState[] = words.map((word, index) => ({
    word,
    role: shuffledRoles[index],
    revealed: false
  }));

  return {
    id: `${seed.toString(36)}-${Math.floor(random() * 0xffffff).toString(36)}`,
    seed,
    cards,
    turn: startingTeam,
    startingTeam,
    turnNumber: 1,
    winner: null,
    history: []
  };
}

export function remainingForTeam(state: GameState, team: Team): number {
  return state.cards.filter((card) => card.role === team && !card.revealed).length;
}

export function visibleRoles(state: GameState): Record<CardRole, number> {
  return state.cards.reduce<Record<CardRole, number>>(
    (counts, card) => {
      if (!card.revealed) counts[card.role] += 1;
      return counts;
    },
    { red: 0, blue: 0, neutral: 0, assassin: 0 }
  );
}

export function cloneGame(state: GameState): GameState {
  return {
    ...state,
    cards: state.cards.map((card) => ({ ...card })),
    history: state.history.map((record) => ({
      ...record,
      targetWords: [...record.targetWords],
      guesses: record.guesses.map((guess) => ({ ...guess }))
    }))
  };
}
