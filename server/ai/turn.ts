import { cloneGame, otherTeam, remainingForTeam } from "../../src/domain/game.js";
import { unresolvedClues } from "../../src/domain/clues.js";
import type {
  ClueAmbition,
  ClueAnalysis,
  GameState,
  GuessPlan,
  OperativeProfile,
  RankedCard,
  RevealedGuess,
  TurnRecord
} from "../../src/domain/types.js";
import type { SemanticSpace } from "../semantic/space.js";
import { checkClueLegality } from "./legality.js";
import { planGuesses } from "./operative.js";
import { generateClue } from "./spymaster.js";

export interface TurnOptions {
  profile?: OperativeProfile;
  providedClue?: string;
  providedNumber?: number;
  maxClueNumber?: number;
  clueAmbition?: ClueAmbition;
  neighborsPerTarget?: number;
  allowUnknownClue?: boolean;
}

export interface TurnResult {
  state: GameState;
  clue: ClueAnalysis;
  plan: GuessPlan;
  revealed: RevealedGuess[];
}

export function analyzeProvidedClue(
  semantic: SemanticSpace,
  state: GameState,
  clue: string,
  number: number,
  allowUnknown = false
): ClueAnalysis {
  const legality = checkClueLegality(clue, state.cards.map((card) => card.word), semantic);
  if (!legality.legal) throw new Error(legality.reason ?? "Недопустимая подсказка.");
  const knownClue = semantic.hasWord(clue);
  if (!knownClue && !allowUnknown) throw new Error(`Слова «${clue}» нет в семантическом словаре.`);

  const rankings = state.cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.revealed)
    .map<RankedCard>(({ card, index }) => ({
      index,
      word: card.word,
      similarity: knownClue ? (semantic.similarity(clue, card.word) ?? -1) : -1,
      rank: 0,
      role: card.role
    }))
    .sort((first, second) => second.similarity - first.similarity);
  rankings.forEach((card, index) => {
    card.rank = index + 1;
  });
  const targetWords = knownClue ? rankings.slice(0, number).map((card) => card.word) : [];
  const weakestTarget = rankings[Math.max(0, number - 1)]?.similarity ?? 0;
  const strongestDanger = knownClue ? (rankings.find((card) => card.role !== state.turn) ?? null) : null;
  const margin = knownClue ? weakestTarget - (strongestDanger?.similarity ?? -1) : 0;

  return {
    word: clue,
    number,
    score: 0,
    confidence: knownClue ? 1 / (1 + Math.exp(-margin * 12)) : 0,
    margin,
    targetWords,
    strongestDanger: strongestDanger?.word ?? null,
    candidateCount: knownClue ? 1 : 0,
    rankings: knownClue ? rankings.slice(0, 10) : []
  };
}

export function runTurn(
  semantic: SemanticSpace,
  inputState: GameState,
  options: TurnOptions = {}
): TurnResult {
  if (inputState.winner) throw new Error("Партия уже закончена.");
  const state = cloneGame(inputState);
  const team = state.turn;
  const providedNumber = Math.max(1, Math.min(9, options.providedNumber ?? 1));
  const clue = options.providedClue
    ? analyzeProvidedClue(semantic, state, options.providedClue, providedNumber, options.allowUnknownClue)
    : generateClue(semantic, state.cards, team, {
        ambition: options.clueAmbition,
        maxNumber: options.maxClueNumber,
        neighborsPerTarget: options.neighborsPerTarget
      });
  const plan = planGuesses(
    semantic,
    state.cards,
    clue.word,
    clue.number,
    options.profile ?? "balanced",
    (state.seed + state.turnNumber * 7919) >>> 0,
    unresolvedClues(state.history, team)
  );

  const resolved = resolveGuesses(state, clue, plan.picks.map((pick) => pick.index), plan.stoppedEarly);
  return { state: resolved.state, clue, plan, revealed: resolved.revealed };
}

export interface ResolveResult {
  state: GameState;
  revealed: RevealedGuess[];
  record: TurnRecord;
}

export function resolveGuesses(
  inputState: GameState,
  clue: Pick<ClueAnalysis, "word" | "number" | "targetWords" | "rankings">,
  pickIndices: readonly number[],
  stoppedEarly = false
): ResolveResult {
  if (inputState.winner) throw new Error("Партия уже закончена.");
  const state = cloneGame(inputState);
  const team = state.turn;
  const revealed: RevealedGuess[] = [];
  const uniquePicks = [...new Set(pickIndices)];
  let endedBy: TurnRecord["endedBy"] = "stopped";

  for (const pickIndex of uniquePicks) {
    const ranking = clue.rankings.find((item) => item.index === pickIndex);
    const pick = ranking ?? { index: pickIndex, similarity: 0 };
    const card = state.cards[pick.index];
    if (!card || card.revealed) continue;
    card.revealed = true;
    revealed.push({
      index: pick.index,
      word: card.word,
      role: card.role,
      similarity: pick.similarity
    });

    if (card.role === "assassin") {
      state.winner = otherTeam(team);
      endedBy = "assassin";
      break;
    }
    if ((card.role === "red" || card.role === "blue") && remainingForTeam(state, card.role) === 0) {
      state.winner = card.role;
      endedBy = "victory";
      break;
    }
    if (card.role !== team) {
      endedBy = "wrong-card";
      break;
    }
  }

  const record: TurnRecord = {
    turn: state.turnNumber,
    team,
    clue: clue.word,
    number: clue.number,
    targetWords: clue.targetWords,
    guesses: revealed,
    remaining: Math.max(0, clue.number - revealed.filter((guess) => guess.role === team).length),
    endedBy
  };
  state.history.push(record);
  if (!state.winner) {
    state.turn = otherTeam(team);
    state.turnNumber += 1;
  }

  return { state, revealed, record };
}
