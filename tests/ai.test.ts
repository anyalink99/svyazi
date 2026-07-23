import { describe, expect, it } from "vitest";
import { refreshTrackedClueRemainders } from "../src/domain/clues.js";
import type { CardState, GameState } from "../src/domain/types.js";
import { checkClueLegality } from "../server/ai/legality.js";
import { planGuesses } from "../server/ai/operative.js";
import { generateClue } from "../server/ai/spymaster.js";
import { analyzeProvidedClue, resolveGuesses, runTurn } from "../server/ai/turn.js";
import { DemoSemanticSpace } from "../server/semantic/demo.js";

const semantic = new DemoSemanticSpace();
const board: CardState[] = [
  { word: "ракета", role: "red", revealed: false },
  { word: "звезда", role: "red", revealed: false },
  { word: "планета", role: "red", revealed: false },
  { word: "хлеб", role: "blue", revealed: false },
  { word: "сыр", role: "blue", revealed: false },
  { word: "яблоко", role: "blue", revealed: false },
  { word: "гитара", role: "blue", revealed: false },
  { word: "скрипка", role: "blue", revealed: false },
  { word: "кошка", role: "neutral", revealed: false },
  { word: "собака", role: "neutral", revealed: false },
  { word: "река", role: "neutral", revealed: false },
  { word: "море", role: "neutral", revealed: false },
  { word: "книга", role: "neutral", revealed: false },
  { word: "учитель", role: "neutral", revealed: false },
  { word: "поезд", role: "neutral", revealed: false },
  { word: "врач", role: "assassin", revealed: false },
  { word: "банк", role: "red", revealed: true },
  { word: "монета", role: "red", revealed: true },
  { word: "лес", role: "red", revealed: true },
  { word: "дерево", role: "red", revealed: true },
  { word: "футбол", role: "red", revealed: true },
  { word: "мяч", role: "red", revealed: true },
  { word: "театр", role: "blue", revealed: true },
  { word: "актёр", role: "blue", revealed: true },
  { word: "дорога", role: "blue", revealed: true }
];

describe("semantic agents", () => {
  it("rejects words and forms already present on the table", () => {
    expect(checkClueLegality("ракета", board.map((card) => card.word), semantic).legal).toBe(false);
  });

  it("finds a clue whose first cards all belong to the team", () => {
    const clue = generateClue(semantic, board, "red", { maxNumber: 3 });
    expect(clue.number).toBeGreaterThanOrEqual(2);
    expect(clue.targetWords.every((word) => ["ракета", "звезда", "планета"].includes(word))).toBe(true);
    expect(clue.rankings.slice(0, clue.number).every((card) => card.role === "red")).toBe(true);
  });

  it("changes the intended clue width with the spymaster ambition", () => {
    const focused = generateClue(semantic, board, "red", { ambition: "focused" });
    const balanced = generateClue(semantic, board, "red", { ambition: "balanced" });
    const broad = generateClue(semantic, board, "red", { ambition: "broad" });

    expect(focused.number).toBeLessThanOrEqual(2);
    expect(balanced.number).toBeGreaterThanOrEqual(focused.number);
    expect(broad.number).toBeGreaterThanOrEqual(balanced.number);
  });

  it("does not repeat a clue that was already spoken", () => {
    const first = generateClue(semantic, board, "red", { ambition: "balanced" });
    const second = generateClue(semantic, board, "red", {
      ambition: "balanced",
      excludedClues: [first.word]
    });

    expect(second.word).not.toBe(first.word);
  });

  it("lets the AI spymaster recount its intended targets from the board", () => {
    const cards = board.map((card) => ({ ...card }));
    cards.find((card) => card.word === "ракета")!.revealed = true;
    const state: GameState = {
      id: "tracked-clue",
      seed: 31,
      cards,
      turn: "red",
      startingTeam: "red",
      turnNumber: 3,
      winner: null,
      history: [{
        turn: 1,
        team: "red",
        clue: "космос",
        number: 2,
        targetWords: ["ракета", "звезда"],
        guesses: [],
        remaining: 2,
        endedBy: "stopped"
      }]
    };

    expect(refreshTrackedClueRemainders(state, "red").history[0].remaining).toBe(1);
  });

  it("does not close a clue when an unrelated same-team card was revealed", () => {
    const cards = board.map((card) => ({ ...card }));
    cards.find((card) => card.word === "планета")!.revealed = true;
    const state: GameState = {
      id: "unrelated-own-card",
      seed: 32,
      cards,
      turn: "red",
      startingTeam: "red",
      turnNumber: 3,
      winner: null,
      history: [{
        turn: 1,
        team: "red",
        clue: "космос",
        number: 2,
        targetWords: ["ракета", "звезда"],
        guesses: [],
        remaining: 2,
        endedBy: "stopped"
      }]
    };

    expect(refreshTrackedClueRemainders(state, "red").history[0].remaining).toBe(2);
  });

  it("lets an operative rank cards without a role map", () => {
    const publicCards = board.map(({ word, revealed }) => ({ word, revealed }));
    const guesses = planGuesses(semantic, publicCards, "космос", 3, "balanced", 7);
    expect(guesses.picks).toHaveLength(3);
    expect(guesses.picks.every((pick) => ["ракета", "звезда", "планета"].includes(pick.word))).toBe(true);
  });

  it("keeps unresolved earlier clues in the operative's semantic context", () => {
    const publicCards = board.map(({ word, revealed }) => ({ word, revealed }));
    const guesses = planGuesses(
      semantic,
      publicCards,
      "космос",
      1,
      "balanced",
      7,
      [{ clue: "музыка", remaining: 1 }]
    );

    expect(guesses.picks.some((pick) => ["гитара", "скрипка"].includes(pick.word))).toBe(true);
    expect(guesses.picks.some((pick) => ["ракета", "звезда", "планета"].includes(pick.word))).toBe(true);
  });

  it("makes balanced operatives aim for the declaration and daring ones sometimes go beyond it", () => {
    const publicCards = board.map(({ word, revealed }) => ({ word, revealed }));
    const balanced = planGuesses(semantic, publicCards, "космос", 2, "balanced", 19);
    const daringRuns = Array.from({ length: 40 }, (_, seed) =>
      planGuesses(semantic, publicCards, "космос", 2, "daring", seed + 1).picks.length
    );

    expect(balanced.picks).toHaveLength(2);
    expect(daringRuns.every((count) => count >= 2)).toBe(true);
    expect(daringRuns.some((count) => count > 2)).toBe(true);
  });

  it("plays a complete agent turn and records it", () => {
    const state: GameState = {
      id: "test",
      seed: 7,
      cards: board,
      turn: "red",
      startingTeam: "red",
      turnNumber: 1,
      winner: null,
      history: []
    };
    const result = runTurn(semantic, state, { profile: "cautious", maxClueNumber: 3 });
    expect(result.state.history).toHaveLength(1);
    expect(result.state.history[0].clueGiver).toBe("ai");
    expect(result.revealed.length).toBeGreaterThan(0);
    expect(result.state.cards.filter((card) => card.revealed).length).toBeGreaterThan(
      board.filter((card) => card.revealed).length
    );
  });

  it("separates clue analysis from authoritative guess resolution", () => {
    const state: GameState = {
      id: "split-turn",
      seed: 17,
      cards: board.map((card) => ({ ...card })),
      turn: "red",
      startingTeam: "red",
      turnNumber: 1,
      winner: null,
      history: []
    };
    const clue = analyzeProvidedClue(semantic, state, "космос", 1);
    const resolved = resolveGuesses(state, clue, [0, 1, 2]);

    expect(resolved.revealed.map((guess) => guess.word)).toEqual(["ракета", "звезда", "планета"]);
    expect(resolved.state.history).toHaveLength(1);
    expect(resolved.record.clueGiver).toBe("human");
    expect(resolved.record.remaining).toBe(1);
    expect(resolved.state.winner).toBe("red");
    expect(state.cards[0].revealed).toBe(false);
  });

  it("keeps the AI spymaster's exact intended words in the turn record", () => {
    const state: GameState = {
      id: "ai-intent",
      seed: 41,
      cards: board.map((card) => ({ ...card })),
      turn: "red",
      startingTeam: "red",
      turnNumber: 1,
      winner: null,
      history: []
    };
    const clue = generateClue(semantic, state.cards, "red", { maxNumber: 3 });
    const resolved = resolveGuesses(state, clue, [clue.rankings[0].index], true, "ai");

    expect(resolved.record.clueGiver).toBe("ai");
    expect(resolved.record.targetWords).toEqual(clue.targetWords);
  });

  it("accepts an out-of-vocabulary human clue when no AI must understand it", () => {
    const state: GameState = {
      id: "human-only-clue",
      seed: 27,
      cards: board.map((card) => ({ ...card })),
      turn: "red",
      startingTeam: "red",
      turnNumber: 1,
      winner: null,
      history: []
    };

    expect(() => analyzeProvidedClue(semantic, state, "квантовость", 2)).toThrow(/словар/iu);
    const clue = analyzeProvidedClue(semantic, state, "квантовость", 2, true);
    expect(clue.rankings).toEqual([]);
    expect(clue.candidateCount).toBe(0);
  });

  it("awards victory when the other team accidentally reveals the final agent", () => {
    const cards = board.map((card) => ({ ...card, revealed: true }));
    const rocket = cards.find((card) => card.word === "ракета")!;
    rocket.role = "red";
    rocket.revealed = false;
    const state: GameState = {
      id: "opponent-finishes-team",
      seed: 12,
      cards,
      turn: "blue",
      startingTeam: "blue",
      turnNumber: 4,
      winner: null,
      history: []
    };

    const result = runTurn(semantic, state, {
      providedClue: "космос",
      providedNumber: 1,
      profile: "daring"
    });

    expect(result.revealed[0]?.word).toBe("ракета");
    expect(result.state.winner).toBe("red");
    expect(result.state.history[0].endedBy).toBe("victory");
  });
});
