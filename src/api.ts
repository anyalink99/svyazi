import { unresolvedClues } from "./domain/clues.js";
import { createGame } from "./domain/game.js";
import type {
  ClueAnalysis,
  ClueAmbition,
  GameState,
  GuessPlan,
  OperativeProfile,
  RevealedGuess,
  SemanticMetadata,
  SimulationSummary
} from "./domain/types.js";
import { BrowserPackedSemanticSpace } from "./semantic/browser-packed.js";
import { planGuesses } from "../server/ai/operative.js";
import { generateClue } from "../server/ai/spymaster.js";
import { analyzeProvidedClue, resolveGuesses, runTurn } from "../server/ai/turn.js";
import { simulateGames } from "../server/simulation.js";

export interface ApiStatus {
  ok: true;
  model: SemanticMetadata;
  modes: string[];
}

export interface TurnResult {
  state: GameState;
  clue: ClueAnalysis;
  plan: GuessPlan;
  revealed: RevealedGuess[];
}

export interface ResolveResult {
  state: GameState;
  clue: ClueAnalysis;
  revealed: RevealedGuess[];
  record: GameState["history"][number];
}

const semanticPromise = BrowserPackedSemanticSpace.load(import.meta.env.BASE_URL);

async function semantic() {
  return semanticPromise;
}

export const api = {
  async status(): Promise<ApiStatus> {
    const space = await semantic();
    return {
      ok: true,
      model: space.metadata,
      modes: ["ai-vs-ai", "human-operative", "human-spymaster", "p2p"]
    };
  },

  async newGame(seed?: number, startingTeam?: "red" | "blue"): Promise<GameState> {
    const space = await semantic();
    return createGame(space.boardWords(), seed, startingTeam);
  },

  async clue(state: GameState, ambition: ClueAmbition = "balanced", maxNumber?: number): Promise<ClueAnalysis> {
    return generateClue(await semantic(), state.cards, state.turn, {
      ambition,
      maxNumber,
      excludedClues: state.history.map((record) => record.clue)
    });
  },

  async analyzeClue(state: GameState, clue: string, number: number, allowUnknown = false): Promise<ClueAnalysis> {
    return analyzeProvidedClue(await semantic(), state, clue, number, allowUnknown);
  },

  async guesses(state: GameState, clue: string, number: number, profile: OperativeProfile): Promise<GuessPlan> {
    return planGuesses(
      await semantic(),
      state.cards,
      clue,
      number,
      profile,
      state.seed + state.turnNumber,
      unresolvedClues(state.history, state.turn)
    );
  },

  async turn(
    state: GameState,
    profile: OperativeProfile,
    provided?: { clue: string; number: number; allowUnknown?: boolean },
    clueAmbition: ClueAmbition = "balanced"
  ): Promise<TurnResult> {
    return runTurn(await semantic(), state, {
      profile,
      providedClue: provided?.clue,
      providedNumber: provided?.number,
      allowUnknownClue: provided?.allowUnknown,
      clueAmbition
    });
  },

  async resolveTurn(
    state: GameState,
    clue: ClueAnalysis,
    picks: number[],
    stoppedEarly = false,
    clueGiver: "human" | "ai" = "human"
  ): Promise<ResolveResult> {
    return { clue, ...resolveGuesses(state, clue, picks, stoppedEarly, clueGiver) };
  },

  async simulate(games: number, redProfile: OperativeProfile, blueProfile: OperativeProfile): Promise<SimulationSummary> {
    const space = await semantic();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    return simulateGames(space, { games, redProfile, blueProfile });
  }
};
