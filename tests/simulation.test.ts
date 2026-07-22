import { describe, expect, it } from "vitest";
import { DemoSemanticSpace } from "../server/semantic/demo.js";
import { simulateGames } from "../server/simulation.js";

describe("self-play simulation", () => {
  it("finishes a deterministic batch and reports metrics", () => {
    const summary = simulateGames(new DemoSemanticSpace(), {
      games: 2,
      seed: 123,
      maxTurns: 12,
      neighborsPerTarget: 12
    });
    expect(summary.games).toBe(2);
    expect(summary.redWins + summary.blueWins).toBe(2);
    expect(summary.averageTurns).toBeGreaterThan(0);
    expect(summary.averageCorrectPerTurn).toBeGreaterThanOrEqual(0);
  });
});
