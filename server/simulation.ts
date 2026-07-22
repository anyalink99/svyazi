import { createGame } from "../src/domain/game.js";
import type { OperativeProfile, SimulationSummary, Team } from "../src/domain/types.js";
import { runTurn } from "./ai/turn.js";
import type { SemanticSpace } from "./semantic/space.js";

export interface SimulationOptions {
  games?: number;
  seed?: number;
  redProfile?: OperativeProfile;
  blueProfile?: OperativeProfile;
  maxTurns?: number;
  neighborsPerTarget?: number;
  onProgress?: (completed: number, total: number) => void;
}

export function simulateGames(
  semantic: SemanticSpace,
  options: SimulationOptions = {}
): SimulationSummary {
  const games = Math.max(1, Math.floor(options.games ?? 100));
  const seed = (options.seed ?? 20260722) >>> 0;
  const maxTurns = Math.max(4, options.maxTurns ?? 40);
  const profiles: Record<Team, OperativeProfile> = {
    red: options.redProfile ?? "balanced",
    blue: options.blueProfile ?? "balanced"
  };
  const startedAt = performance.now();
  let redWins = 0;
  let blueWins = 0;
  let assassinFinishes = 0;
  let totalTurns = 0;
  let totalClueNumber = 0;
  let totalCorrect = 0;
  let totalPlayedTurns = 0;
  const clueNumberDistribution: Record<string, number> = {};

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    let state = createGame(semantic.boardWords(), (seed + Math.imul(gameIndex + 1, 2654435761)) >>> 0);
    let guard = 0;
    while (!state.winner && guard < maxTurns) {
      const team = state.turn;
      const result = runTurn(semantic, state, {
        profile: profiles[team],
        maxClueNumber: 4,
        neighborsPerTarget: options.neighborsPerTarget ?? 56
      });
      state = result.state;
      totalPlayedTurns += 1;
      totalClueNumber += result.clue.number;
      totalCorrect += result.revealed.filter((guess) => guess.role === team).length;
      clueNumberDistribution[String(result.clue.number)] =
        (clueNumberDistribution[String(result.clue.number)] ?? 0) + 1;
      if (state.history.at(-1)?.endedBy === "assassin") assassinFinishes += 1;
      guard += 1;
    }

    if (!state.winner) {
      const redRemaining = state.cards.filter((card) => card.role === "red" && !card.revealed).length;
      const blueRemaining = state.cards.filter((card) => card.role === "blue" && !card.revealed).length;
      state.winner = redRemaining <= blueRemaining ? "red" : "blue";
    }
    if (state.winner === "red") redWins += 1;
    else blueWins += 1;
    totalTurns += state.history.length;

    if (options.onProgress && ((gameIndex + 1) % Math.max(1, Math.floor(games / 100)) === 0 || gameIndex + 1 === games)) {
      options.onProgress(gameIndex + 1, games);
    }
  }

  const durationMs = performance.now() - startedAt;
  return {
    games,
    seed,
    redWins,
    blueWins,
    assassinFinishes,
    averageTurns: totalTurns / games,
    averageClueNumber: totalPlayedTurns ? totalClueNumber / totalPlayedTurns : 0,
    averageCorrectPerTurn: totalPlayedTurns ? totalCorrect / totalPlayedTurns : 0,
    clueNumberDistribution,
    durationMs
  };
}
