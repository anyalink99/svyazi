import { hashString, mulberry32, normalRandom } from "../../src/domain/random.js";
import type { ClueMemory } from "../../src/domain/clues.js";
import type { CardState, GuessPlan, OperativeProfile, RankedCard } from "../../src/domain/types.js";
import type { SemanticSpace } from "../semantic/space.js";

interface ProfileSettings {
  strategy: "cautious" | "declared" | "push";
  noise: number;
  minimumSimilarity: number;
  beyondClueMinimum: number;
  uncertaintyStop: number;
}

const PROFILE_SETTINGS: Record<OperativeProfile, ProfileSettings> = {
  cautious: { strategy: "cautious", noise: 0.018, minimumSimilarity: 0.24, beyondClueMinimum: 0.44, uncertaintyStop: 0.025 },
  balanced: { strategy: "declared", noise: 0.038, minimumSimilarity: 0.035, beyondClueMinimum: 1, uncertaintyStop: 0.003 },
  daring: { strategy: "push", noise: 0.068, minimumSimilarity: -1, beyondClueMinimum: -1, uncertaintyStop: -1 }
};

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
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
  const expectedAnswers = activeClues.reduce((sum, item) => sum + item.remaining, 0);
  const settings = PROFILE_SETTINGS[profile];
  const contextKey = activeClues.map((item) => `${item.clue}:${item.remaining}`).join("|");
  const random = mulberry32((seed ^ hashString(`${contextKey}:${profile}`)) >>> 0);
  const candidates = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.revealed)
    .map(({ card, index }) => {
      const clueSimilarities = activeClues.map((item) => semantic.similarity(item.clue, card.word));
      if (clueSimilarities.every((similarity) => similarity === null)) {
        throw new Error(`Слова «${card.word}» нет в семантическом словаре.`);
      }
      const similarities = clueSimilarities.filter((similarity): similarity is number => similarity !== null);
      const noiseOffset = normalRandom(random) * settings.noise;
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
