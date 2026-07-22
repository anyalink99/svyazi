import type { CardState, ClueAmbition, ClueAnalysis, RankedCard, Team } from "../../src/domain/types.js";
import { hashString } from "../../src/domain/random.js";
import { createClueValidator, type LegalityResult } from "./legality.js";
import { canonicalWord, type SemanticSpace } from "../semantic/space.js";

export interface SpymasterOptions {
  ambition?: ClueAmbition;
  maxNumber?: number;
  neighborsPerTarget?: number;
  excludedClues?: readonly string[];
}

const AMBITION_SETTINGS: Record<ClueAmbition, { maxNumber: number; baseTarget: number; extraChance: number; targetPull: number }> = {
  focused: { maxNumber: 2, baseTarget: 1, extraChance: 0.29, targetPull: 4.5 },
  balanced: { maxNumber: 4, baseTarget: 2, extraChance: 0.78, targetPull: 7 },
  broad: { maxNumber: 5, baseTarget: 3, extraChance: 0.95, targetPull: 10 }
};

interface BoardSemanticContext {
  neighborsByWord: Map<string, Array<{ word: string; score: number }>>;
  scoreMaps: Map<string, Map<string, number>>;
  floorScores: Map<string, number>;
  legality: Map<string, LegalityResult>;
  validate: (clue: string) => LegalityResult;
}

const CONTEXT_CACHE_LIMIT = 8;
const contextCaches = new WeakMap<SemanticSpace, Map<string, BoardSemanticContext>>();

function getBoardContext(
  semantic: SemanticSpace,
  boardWords: readonly string[]
): BoardSemanticContext {
  let cache = contextCaches.get(semantic);
  if (!cache) {
    cache = new Map();
    contextCaches.set(semantic, cache);
  }
  const key = boardWords.join("\u0000");
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const neighborsByWord = new Map<string, Array<{ word: string; score: number }>>();
  const scoreMaps = new Map<string, Map<string, number>>();
  const floorScores = new Map<string, number>();
  const fullLimit = semantic.metadata.neighborsPerBoardWord;
  for (const word of boardWords) {
    const neighbors = semantic.neighborsWithScores(word, fullLimit);
    neighborsByWord.set(word, neighbors);
    scoreMaps.set(word, new Map(neighbors.map((entry) => [entry.word, entry.score])));
    floorScores.set(word, (neighbors.at(-1)?.score ?? 0) - 0.012);
  }
  const context: BoardSemanticContext = {
    neighborsByWord,
    scoreMaps,
    floorScores,
    legality: new Map(),
    validate: createClueValidator(boardWords, semantic)
  };
  cache.set(key, context);
  if (cache.size > CONTEXT_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return context;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function generateClue(
  semantic: SemanticSpace,
  cards: readonly CardState[],
  team: Team,
  options: SpymasterOptions = {}
): ClueAnalysis {
  const unrevealed = cards
    .map((card, index) => ({ ...card, index }))
    .filter((card) => !card.revealed);
  const ownWords = unrevealed.filter((card) => card.role === team).map((card) => card.word);
  if (ownWords.length === 0) throw new Error("У команды не осталось слов.");

  const ambitionName = options.ambition ?? "balanced";
  const ambition = AMBITION_SETTINGS[ambitionName];
  const maxNumber = Math.max(1, Math.min(options.maxNumber ?? ambition.maxNumber, ownWords.length));
  const neighborLimit = options.neighborsPerTarget ?? 160;
  const boardWords = cards.map((card) => card.word);
  const targetRoll = hashString(`${boardWords.join("|")}:${team}:${ambitionName}`) / 0x1_0000_0000;
  const desiredNumber = Math.min(
    maxNumber,
    ambition.baseTarget + (targetRoll < ambition.extraChance ? 1 : 0)
  );
  const context = getBoardContext(semantic, boardWords);
  const excludedClues = new Set((options.excludedClues ?? []).map(canonicalWord));
  const candidateSet = new Set<string>();
  for (const card of unrevealed) {
    const neighbors = context.neighborsByWord.get(card.word)?.slice(0, neighborLimit) ?? [];
    if (card.role === team) {
      for (const entry of neighbors) candidateSet.add(entry.word);
    }
  }
  const candidates = [...candidateSet];
  let legalCandidateCount = 0;
  let best: ClueAnalysis | null = null;
  let bestRiskyFallback: ClueAnalysis | null = null;

  for (const candidate of candidates) {
    if (excludedClues.has(canonicalWord(candidate))) continue;
    let legality = context.legality.get(candidate);
    if (!legality) {
      legality = context.validate(candidate);
      context.legality.set(candidate, legality);
    }
    if (!legality.legal) continue;

    const ranked: Array<RankedCard & { role: CardState["role"] }> = [];
    for (const card of unrevealed) {
      const similarity = context.scoreMaps.get(card.word)?.get(candidate) ?? context.floorScores.get(card.word) ?? 0;
      ranked.push({
        index: card.index,
        word: card.word,
        similarity,
        rank: 0,
        role: card.role
      });
    }
    legalCandidateCount += 1;

    ranked.sort((first, second) => second.similarity - first.similarity || first.word.localeCompare(second.word, "ru"));
    ranked.forEach((card, index) => {
      card.rank = index + 1;
    });

    let safePrefix = 0;
    while (safePrefix < ranked.length && ranked[safePrefix].role === team) safePrefix += 1;
    safePrefix = Math.min(safePrefix, maxNumber);

    const nonTeam = ranked.filter((card) => card.role !== team);
    const strongestDanger = nonTeam[0] ?? null;
    const assassinSimilarity = ranked.find((card) => card.role === "assassin")?.similarity ?? -1;
    const enemySimilarity = Math.max(
      -1,
      ...ranked.filter((card) => card.role !== team && card.role !== "neutral" && card.role !== "assassin").map((card) => card.similarity)
    );
    const neutralSimilarity = Math.max(
      -1,
      ...ranked.filter((card) => card.role === "neutral").map((card) => card.similarity)
    );

    if (safePrefix === 0) {
      const strongestOwn = ranked.find((card) => card.role === team);
      if (!strongestOwn) continue;
      const cardsBeforeTarget = strongestOwn.rank - 1;
      const topCard = ranked[0];
      const margin = strongestOwn.similarity - (strongestDanger?.similarity ?? -1);
      const immediateAssassinPenalty = topCard.role === "assassin" ? 8 : 0;
      const immediateEnemyPenalty = topCard.role !== team && topCard.role !== "neutral" && topCard.role !== "assassin" ? 2.5 : 0;
      const fallbackScore =
        strongestOwn.similarity * 2.2 +
        margin * 6.5 -
        cardsBeforeTarget * 0.9 -
        immediateAssassinPenalty -
        immediateEnemyPenalty;
      const fallback: ClueAnalysis = {
        word: candidate,
        number: 1,
        score: round(fallbackScore),
        confidence: round(sigmoid((margin - 0.015) * 12)),
        margin: round(margin),
        targetWords: [strongestOwn.word],
        strongestDanger: strongestDanger?.word ?? null,
        candidateCount: legalCandidateCount,
        rankings: ranked.slice(0, 10).map((card) => ({
          ...card,
          similarity: round(card.similarity)
        }))
      };
      if (
        !bestRiskyFallback ||
        fallback.score > bestRiskyFallback.score ||
        (fallback.score === bestRiskyFallback.score && fallback.margin > bestRiskyFallback.margin) ||
        (fallback.score === bestRiskyFallback.score && fallback.margin === bestRiskyFallback.margin &&
          fallback.word.localeCompare(bestRiskyFallback.word, "ru") < 0)
      ) {
        bestRiskyFallback = fallback;
      }
      if (ambitionName !== "broad") continue;
    }

    const ownRanked = ranked.filter((card) => card.role === team);
    const evaluatedPrefix = ambitionName === "broad"
      ? Math.min(maxNumber, ownRanked.length)
      : safePrefix;
    for (let number = 1; number <= evaluatedPrefix; number += 1) {
      const targets = ambitionName === "broad" ? ownRanked.slice(0, number) : ranked.slice(0, number);
      const meanTarget = targets.reduce((sum, card) => sum + card.similarity, 0) / number;
      const weakestTarget = targets[number - 1].similarity;
      const intruders = ranked
        .slice(0, targets[number - 1].rank - 1)
        .filter((card) => card.role !== team);
      if (ambitionName === "broad" && (intruders.length > 2 || intruders.some((card) => card.role === "assassin"))) {
        continue;
      }
      const dangerSimilarity = strongestDanger?.similarity ?? -1;
      const margin = weakestTarget - dangerSimilarity;
      const assassinPressure = Math.max(0, assassinSimilarity - 0.16);
      const enemyPressure = Math.max(0, enemySimilarity - 0.28);
      const neutralPressure = Math.max(0, neutralSimilarity - 0.35);
      const targetDistance = Math.abs(number - desiredNumber);
      const score =
        -targetDistance * ambition.targetPull +
        Math.min(number, desiredNumber) * 0.12 +
        meanTarget * 1.35 +
        weakestTarget * 0.8 +
        margin * 5.2 -
        intruders.length * 3.1 -
        assassinPressure * 2.7 -
        enemyPressure * 0.8 -
        neutralPressure * 0.35;

      const analysis: ClueAnalysis = {
        word: candidate,
        number,
        score: round(score),
        confidence: round(sigmoid((margin - 0.015) * 12)),
        margin: round(margin),
        targetWords: targets.map((card) => card.word),
        strongestDanger: strongestDanger?.word ?? null,
        candidateCount: legalCandidateCount,
        rankings: ranked.slice(0, 10).map((card) => ({
          ...card,
          similarity: round(card.similarity)
        }))
      };

      if (
        !best ||
        analysis.score > best.score ||
        (analysis.score === best.score && analysis.margin > best.margin) ||
        (analysis.score === best.score && analysis.margin === best.margin && analysis.word.localeCompare(best.word, "ru") < 0)
      ) {
        best = analysis;
      }
    }
  }

  if (!best && neighborLimit < semantic.metadata.neighborsPerBoardWord) {
    return generateClue(semantic, cards, team, {
      ...options,
      neighborsPerTarget: semantic.metadata.neighborsPerBoardWord
    });
  }
  if (!best && bestRiskyFallback) {
    bestRiskyFallback.candidateCount = legalCandidateCount;
    return bestRiskyFallback;
  }
  if (!best) {
    throw new Error("Не удалось найти ни одной допустимой подсказки в семантическом словаре.");
  }
  best.candidateCount = legalCandidateCount;
  return best;
}
