import { hashString, mulberry32, normalRandom } from "../../src/domain/random.js";
import type { ClueMemory } from "../../src/domain/clues.js";
import type { CardState, GuessPlan, OperativeProfile, RankedCard } from "../../src/domain/types.js";
import type { SemanticSpace } from "../semantic/space.js";
import { canonicalWord } from "../semantic/space.js";

interface ProfileSettings {
  strategy: "cautious" | "declared" | "push";
  noise: number;
  minimumSimilarity: number;
  beyondClueMinimum: number;
  uncertaintyStop: number;
}

const PROFILE_SETTINGS: Record<OperativeProfile, ProfileSettings> = {
  cautious: { strategy: "cautious", noise: 0.01, minimumSimilarity: 0.24, beyondClueMinimum: 0.44, uncertaintyStop: 0.025 },
  balanced: { strategy: "declared", noise: 0.014, minimumSimilarity: 0.035, beyondClueMinimum: 1, uncertaintyStop: 0.003 },
  daring: { strategy: "push", noise: 0.018, minimumSimilarity: -1, beyondClueMinimum: -1, uncertaintyStop: -1 }
};

const DIRECT_MODEL_CONFIDENCE = 0.28;
const DIRECT_MODEL_SUPPORT = 0.22;
const DIRECT_MODEL_BAND = 0.18;

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

interface ClueVariant {
  word: string;
  weight: number;
  depth: 0 | 1 | 2;
}

function clueVariants(semantic: SemanticSpace, clue: string): ClueVariant[] {
  const variants = new Map<string, ClueVariant>();
  const add = (word: string, weight: number, depth: ClueVariant["depth"]) => {
    const canonical = canonicalWord(word);
    const current = variants.get(canonical);
    if (!current || weight > current.weight || (weight === current.weight && depth < current.depth)) {
      variants.set(canonical, { word: canonical, weight, depth });
    }
  };
  add(clue, 1, 0);
  const direct = semantic.lexicalNeighbors(clue).slice(0, 24);
  for (const relation of direct) add(relation.word, relation.score * 0.98, 1);
  for (const relation of direct.slice(0, 14)) {
    const synonyms = semantic.lexicalNeighbors(relation.word).filter((second) => second.score >= 0.99).slice(0, 10);
    for (const second of synonyms) {
      add(second.word, relation.score * second.score * 0.82, 2);
    }
  }
  return [...variants.values()].sort((first, second) => second.weight - first.weight).slice(0, 48);
}

function relatedSimilarity(
  semantic: SemanticSpace,
  variants: readonly ClueVariant[],
  cardWord: string,
  directFloor: number | null
): number | null {
  const directVector = semantic.similarity(variants[0].word, cardWord);
  const canonicalCard = canonicalWord(cardWord);
  const cardRelations = new Map(semantic.lexicalNeighbors(cardWord).map((relation) => [canonicalWord(relation.word), relation.score]));
  const directlyRelated = cardRelations.has(variants[0].word) || variants.some((variant) => variant.depth === 1 && variant.word === canonicalCard);
  if (directFloor !== null && directVector !== null && directVector < directFloor && !directlyRelated) return directVector;
  let best: number | null = null;
  const sharedConcepts: number[] = [];
  let directReverse: number | null = null;
  for (const variant of variants) {
    const vector = semantic.similarity(variant.word, cardWord);
    if (vector !== null) {
      const expanded = vector - (1 - variant.weight) * 0.16;
      best = best === null ? expanded : Math.max(best, expanded);
    }
    const reverseLexical = cardRelations.get(variant.word);
    if (reverseLexical !== undefined && variant.depth === 0) {
      directReverse = reverseLexical;
    } else if (reverseLexical !== undefined && variant.depth === 1) {
      sharedConcepts.push(reverseLexical * variant.weight * semantic.lexicalSpecificity(variant.word));
    }
    if (variant.word === canonicalCard) {
      const exact = variant.depth === 0 || variant.weight >= 0.97
        ? variant.weight
        : variant.weight * (0.25 + semantic.lexicalSpecificity(variant.word) * 0.75);
      best = best === null ? exact : Math.max(best, exact);
    }
  }
  // A single broad category is not evidence: polysemous chains such as
  // "военный -> деловой <- лес" used to overpower the actual vector ranking.
  // Direct card-to-clue relations are useful but calibrated; expanded concepts
  // may dominate only when two independent lexical paths agree.
  if (directReverse !== null) {
    if (directReverse >= 0.99) {
      best = best === null ? directReverse : Math.max(best, directReverse);
    } else if (best !== null) {
      best = Math.min(1, best + directReverse * semantic.lexicalSpecificity(variants[0].word) * 0.22);
    }
  }
  sharedConcepts.sort((first, second) => second - first);
  if (sharedConcepts.length >= 2) {
    const agreement = (sharedConcepts[0] + sharedConcepts[1]) * 0.14;
    best = best === null ? agreement : Math.min(1, best + agreement);
  }
  return best;
}

export function planGuesses(
  semantic: SemanticSpace,
  cards: readonly Pick<CardState, "word" | "revealed">[],
  clue: string,
  number: number,
  profile: OperativeProfile = "balanced",
  seed = 1,
  memory: readonly ClueMemory[] = []
): GuessPlan {
  if (!semantic.hasWord(clue)) {
    throw new Error(`Слова «${clue}» нет в семантическом словаре.`);
  }

  const clueCounts = new Map<string, number>();
  for (const item of [...memory, { clue, remaining: number }]) {
    if (item.remaining <= 0 || !semantic.hasWord(item.clue)) continue;
    clueCounts.set(item.clue, (clueCounts.get(item.clue) ?? 0) + item.remaining);
  }
  const activeClues = [...clueCounts].map(([word, remaining]) => ({ clue: word, remaining }));
  const activeVariants = activeClues.map((item) => clueVariants(semantic, item.clue));
  const openCards = cards.filter((card) => !card.revealed);
  const directFloors = activeClues.map((item) => {
    const directScores = openCards
      .map((card) => semantic.similarity(item.clue, card.word))
      .filter((similarity): similarity is number => similarity !== null)
      .sort((first, second) => second - first);
    const strongest = directScores[0] ?? -1;
    // Require a cluster, not one possibly polysemous outlier, before the base
    // model is allowed to veto weaker expansion paths.
    const supported = (directScores[1] ?? -1) >= DIRECT_MODEL_SUPPORT;
    return strongest >= DIRECT_MODEL_CONFIDENCE && supported ? strongest - DIRECT_MODEL_BAND : null;
  });
  const expectedAnswers = activeClues.reduce((sum, item) => sum + item.remaining, 0);
  const settings = PROFILE_SETTINGS[profile];
  const contextKey = activeClues.map((item) => `${item.clue}:${item.remaining}`).join("|");
  const random = mulberry32((seed ^ hashString(`${contextKey}:${profile}`)) >>> 0);
  const candidates = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.revealed)
    .map(({ card, index }) => {
      const clueSimilarities = activeVariants.map((variants, clueIndex) =>
        relatedSimilarity(semantic, variants, card.word, directFloors[clueIndex])
      );
      if (clueSimilarities.every((similarity) => similarity === null)) {
        throw new Error(`Слова «${card.word}» нет в семантическом словаре.`);
      }
      const similarities = clueSimilarities.filter((similarity): similarity is number => similarity !== null);
      // Randomness may shuffle genuinely close associations, but it should not
      // overpower a meaningful semantic gap between two cards.
      const boundedNoise = Math.max(-1, Math.min(1, normalRandom(random)));
      const noiseOffset = boundedNoise * settings.noise;
      return {
        index,
        word: card.word,
        clueSimilarities: clueSimilarities.map((similarity) => similarity ?? -1),
        similarity: Math.max(...similarities),
        noiseOffset
      };
    })
    .sort((first, second) =>
      second.similarity + second.noiseOffset - (first.similarity + first.noiseOffset)
    );

  const rankings: RankedCard[] = [];
  const unassigned = new Set(candidates.map((candidate) => candidate.index));
  const quotas = activeClues.map((item) => item.remaining);
  while (quotas.some((quota) => quota > 0) && unassigned.size) {
    let bestCandidate: (typeof candidates)[number] | null = null;
    let bestClueIndex = -1;
    let bestScore = -Infinity;
    for (let clueIndex = 0; clueIndex < quotas.length; clueIndex += 1) {
      if (quotas[clueIndex] <= 0) continue;
      for (const candidate of candidates) {
        if (!unassigned.has(candidate.index)) continue;
        const score = candidate.clueSimilarities[clueIndex] + candidate.noiseOffset;
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
          bestClueIndex = clueIndex;
        }
      }
    }
    if (!bestCandidate || bestClueIndex < 0) break;
    rankings.push({
      index: bestCandidate.index,
      word: bestCandidate.word,
      similarity: bestCandidate.clueSimilarities[bestClueIndex],
      noisyScore: bestScore,
      rank: 0
    });
    unassigned.delete(bestCandidate.index);
    quotas[bestClueIndex] -= 1;
  }

  for (const candidate of candidates) {
    if (!unassigned.has(candidate.index)) continue;
    rankings.push({
      index: candidate.index,
      word: candidate.word,
      similarity: candidate.similarity,
      noisyScore: candidate.similarity + candidate.noiseOffset,
      rank: 0
    });
  }

  rankings.forEach((card, index) => {
    card.rank = index + 1;
  });

  const picks: RankedCard[] = [];
  let stopReason: string | null = null;
  const extraRandom = mulberry32((seed ^ hashString(`${contextKey}:${profile}:extra`)) >>> 0);
  const extraRoll = extraRandom();
  const daringExtra = extraRoll < 0.1 ? 2 : extraRoll < 0.45 ? 1 : 0;
  const plannedAnswers = settings.strategy === "push"
    ? Math.min(rankings.length, expectedAnswers + daringExtra)
    : expectedAnswers;

  for (let index = 0; index < rankings.length; index += 1) {
    const current = rankings[index];
    const next = rankings[index + 1];

    if (settings.strategy !== "cautious" && index >= plannedAnswers) {
      stopReason = settings.strategy === "push" && daringExtra > 0
        ? "Рискованный игрок сделал дополнительную попытку."
        : "Заявленное число ответов набрано.";
      break;
    }

    const requiredSimilarity = index >= expectedAnswers
      ? Math.max(settings.minimumSimilarity, settings.beyondClueMinimum)
      : settings.minimumSimilarity;
    if (settings.strategy !== "push" && current.similarity < requiredSimilarity) {
      stopReason = "Связь со следующей карточкой слишком слабая.";
      break;
    }
    if (
      settings.strategy !== "push" &&
      index > 0 &&
      next &&
      current.similarity < (settings.strategy === "declared" ? 0.14 : 0.34) &&
      current.similarity - next.similarity < settings.uncertaintyStop
    ) {
      stopReason = "Следующие варианты почти неразличимы.";
      break;
    }
    picks.push({
      ...current,
      similarity: round(current.similarity),
      noisyScore: round(current.noisyScore ?? current.similarity)
    });
  }

  return {
    clue,
    number,
    profile,
    picks,
    stoppedEarly: picks.length < rankings.length,
    stopReason
  };
}
