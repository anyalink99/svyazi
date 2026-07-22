import { describe, expect, it } from "vitest";
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

  it("lets an operative rank cards without a role map", () => {
    const publicCards = board.map(({ word, revealed }) => ({ word, revealed }));
    const guesses = planGuesses(semantic, publicCards, "космос", 3, "balanced", 7);
    expect(guesses.picks).toHaveLength(3);
    expect(guesses.picks.every((pick) => ["ракета", "звезда", "планета"].includes(pick.word))).toBe(true);
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

    expect(resolved.revealed.map((guess) => guess.word)).toEqual(["ракета", "звезда"]);
    expect(resolved.state.history).toHaveLength(1);
    expect(resolved.state.turn).toBe("blue");
    expect(state.cards[0].revealed).toBe(false);
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
