import { canonicalWord, type SemanticSpace } from "../semantic/space.js";

export interface LegalityResult {
  legal: boolean;
  reason: string | null;
}

interface BoardWordShape {
  source: string;
  normalized: string;
  stem: string;
}

function commonPrefixLength(first: string, second: string): number {
  const limit = Math.min(first.length, second.length);
  let index = 0;
  while (index < limit && first[index] === second[index]) index += 1;
  return index;
}

export function createClueValidator(
  boardWords: readonly string[],
  semantic: SemanticSpace
): (clue: string) => LegalityResult {
  const boardShapes: BoardWordShape[] = boardWords.map((source) => {
    const normalized = canonicalWord(source);
    return {
      source,
      normalized,
      stem: canonicalWord(semantic.stemOf(normalized))
    };
  });

  return (clue: string): LegalityResult => {
    const normalized = canonicalWord(clue);
    if (!normalized || !/^[а-яё-]+$/u.test(clue.trim().toLocaleLowerCase("ru-RU"))) {
      return { legal: false, reason: "Подсказка должна быть одним русским словом." };
    }
    if (normalized.length < 2) {
      return { legal: false, reason: "Подсказка слишком короткая." };
    }

    const clueStem = canonicalWord(semantic.stemOf(normalized));
    for (const boardWord of boardShapes) {
      const board = boardWord.normalized;
      if (normalized === board) {
        return { legal: false, reason: `На поле уже есть слово «${boardWord.source}».` };
      }

      if (clueStem.length >= 3 && boardWord.stem.length >= 3 && clueStem === boardWord.stem) {
        return { legal: false, reason: `«${clue}» — форма слова «${boardWord.source}».` };
      }

      const prefix = commonPrefixLength(normalized, board);
      const shorter = Math.min(normalized.length, board.length);
      const looksDerived =
        (prefix >= 4 && prefix / shorter >= 0.78) ||
        (shorter <= 4 && prefix >= 3 && Math.abs(normalized.length - board.length) <= 3);
      if (looksDerived) {
        return { legal: false, reason: `«${clue}» слишком похоже на «${boardWord.source}».` };
      }

      if (
        Math.min(normalized.length, board.length) >= 5 &&
        (normalized.includes(board) || board.includes(normalized))
      ) {
        return { legal: false, reason: `«${clue}» содержит слово с поля «${boardWord.source}».` };
      }
    }

    return { legal: true, reason: null };
  };
}

export function checkClueLegality(
  clue: string,
  boardWords: readonly string[],
  semantic: SemanticSpace
): LegalityResult {
  return createClueValidator(boardWords, semantic)(clue);
}
