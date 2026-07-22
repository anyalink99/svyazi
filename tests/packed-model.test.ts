import { describe, expect, it } from "vitest";
import { createGame } from "../src/domain/game.js";
import { runTurn } from "../server/ai/turn.js";
import { PackedSemanticSpace } from "../server/semantic/packed.js";

describe("packed Navec model", () => {
  it("loads the complete local model and plays a turn", async () => {
    const semantic = await PackedSemanticSpace.load("data/model");

    expect(semantic.metadata.kind).toBe("navec");
    expect(semantic.metadata.vocabularySize).toBeGreaterThanOrEqual(50_000);
    expect(semantic.boardWords()).toHaveLength(2_500);
    expect(semantic.neighborsWithScores(semantic.boardWords()[0], 12)).toHaveLength(12);

    const state = createGame(semantic.boardWords(), 20260722, "red");
    const result = runTurn(semantic, state, {
      profile: "balanced",
      maxClueNumber: 4,
      neighborsPerTarget: 56
    });

    expect(result.clue.word.length).toBeGreaterThan(1);
    expect(result.clue.number).toBeGreaterThanOrEqual(1);
    expect(result.state.history).toHaveLength(1);
    expect(result.revealed.length).toBeGreaterThan(0);
  });
});
