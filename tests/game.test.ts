import { describe, expect, it } from "vitest";
import { createGame, remainingForTeam } from "../src/domain/game.js";

const WORDS = Array.from({ length: 60 }, (_, index) => `слово${index}`);

describe("game engine", () => {
  it("creates a deterministic 25-card key", () => {
    const first = createGame(WORDS, 42, "red");
    const second = createGame(WORDS, 42, "red");

    expect(first.cards).toEqual(second.cards);
    expect(first.cards).toHaveLength(25);
    expect(first.cards.filter((card) => card.role === "red")).toHaveLength(9);
    expect(first.cards.filter((card) => card.role === "blue")).toHaveLength(8);
    expect(first.cards.filter((card) => card.role === "neutral")).toHaveLength(7);
    expect(first.cards.filter((card) => card.role === "assassin")).toHaveLength(1);
    expect(remainingForTeam(first, "red")).toBe(9);
  });

  it("gives the starting team the ninth card", () => {
    const game = createGame(WORDS, 99, "blue");
    expect(game.turn).toBe("blue");
    expect(game.cards.filter((card) => card.role === "blue")).toHaveLength(9);
    expect(game.cards.filter((card) => card.role === "red")).toHaveLength(8);
  });
});
