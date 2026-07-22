import { hashString, mulberry32, normalRandom } from "../../src/domain/random.js";
import type { ClueMemory } from "../../src/domain/clues.js";
import type { CardState, GuessPlan, OperativeProfile, RankedCard } from "../../src/domain/types.js";
import type { SemanticSpace } from "../semantic/space.js";

interface ProfileSettings {
  noise: number;
  minimumSimilarity: number;
  beyondClueMinimum: number;
  uncertaintyStop: number;
}

const PROFILE_SETTINGS: Record<OperativeProfile, ProfileSettings> = {
  cautious: { noise: 0.018, minimumSimilarity: 0.24, beyondClueMinimum: 0.44, uncertaintyStop: 0.025 },
  balanced: { noise: 0.038, minimumSimilarity: 0.12, beyondClueMinimum: 0.29, uncertaintyStop: 0.008 },
  daring: { noise: 0.068, minimumSimilarity: 0.02, beyondClueMinimum: 0.05, uncertaintyStop: -1 }
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
  const rankings: RankedCard[] = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.revealed)
    .map(({ card, index }) => {
      const similarities = activeClues
        .map((item) => semantic.similarity(item.clue, card.word))
        .filter((similarity): similarity is number => similarity !== null);
      if (!similarities.length) throw new Error(`Слова «${card.word}» нет в семантическом словаре.`);
      const similarity = Math.max(...similarities);
      return {
        index,
        word: card.word,
        similarity,
        noisyScore: similarity + normalRandom(random) * settings.noise,
        rank: 0
      };
    })
    .sort((first, second) => (second.noisyScore ?? 0) - (first.noisyScore ?? 0));

  rankings.forEach((card, index) => {
    card.rank = index + 1;
  });

  const picks: RankedCard[] = [];
  let stopReason: string | null = null;

  for (let index = 0; index < rankings.length; index += 1) {
    const current = rankings[index];
    const next = rankings[index + 1];
    const requiredSimilarity = index >= expectedAnswers
      ? Math.max(settings.minimumSimilarity, settings.beyondClueMinimum)
      : settings.minimumSimilarity;
    if (current.similarity < requiredSimilarity) {
      stopReason = "Связь со следующей карточкой слишком слабая.";
      break;
    }
    if (
      index > 0 &&
      next &&
      current.similarity < 0.34 &&
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
