import { hashString, mulberry32, normalRandom } from "../../src/domain/random.js";
import type { CardState, GuessPlan, OperativeProfile, RankedCard } from "../../src/domain/types.js";
import type { SemanticSpace } from "../semantic/space.js";

interface ProfileSettings {
  noise: number;
  minimumSimilarity: number;
  extraGuess: boolean;
  uncertaintyStop: number;
}

const PROFILE_SETTINGS: Record<OperativeProfile, ProfileSettings> = {
  cautious: { noise: 0.018, minimumSimilarity: 0.24, extraGuess: false, uncertaintyStop: 0.025 },
  balanced: { noise: 0.038, minimumSimilarity: 0.12, extraGuess: false, uncertaintyStop: 0.008 },
  daring: { noise: 0.068, minimumSimilarity: 0.02, extraGuess: true, uncertaintyStop: -1 }
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
  seed = 1
): GuessPlan {
  if (!semantic.hasWord(clue)) {
    throw new Error(`Слова «${clue}» нет в семантическом словаре.`);
  }

  const settings = PROFILE_SETTINGS[profile];
  const random = mulberry32((seed ^ hashString(`${clue}:${number}:${profile}`)) >>> 0);
  const rankings: RankedCard[] = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.revealed)
    .map(({ card, index }) => {
      const similarity = semantic.similarity(clue, card.word);
      if (similarity === null) throw new Error(`Слова «${card.word}» нет в семантическом словаре.`);
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

  const maxPicks = Math.min(rankings.length, number + (settings.extraGuess ? 1 : 0));
  const picks: RankedCard[] = [];
  let stopReason: string | null = null;

  for (let index = 0; index < maxPicks; index += 1) {
    const current = rankings[index];
    const next = rankings[index + 1];
    if (current.similarity < settings.minimumSimilarity) {
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
    stoppedEarly: picks.length < maxPicks,
    stopReason
  };
}
