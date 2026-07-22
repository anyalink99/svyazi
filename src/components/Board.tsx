import type { CSSProperties } from "react";
import type { CardState, ClueAnalysis, Team } from "../domain/types.js";

interface BoardProps {
  cards: CardState[];
  clue: ClueAnalysis | null;
  showKey: boolean;
  showTrace: boolean;
  interactive: boolean;
  currentTeam: Team;
  onCardClick: (index: number) => void;
}

const ROLE_LABELS = {
  red: "красная команда",
  blue: "синяя команда",
  neutral: "мирный житель",
  assassin: "убийца"
};

export function Board({
  cards,
  clue,
  showKey,
  showTrace,
  interactive,
  currentTeam,
  onCardClick
}: BoardProps) {
  const rankingByIndex = new Map(clue?.rankings.map((ranking) => [ranking.index, ranking]) ?? []);
  const visibleSimilarities = clue?.rankings.map((ranking) => ranking.similarity) ?? [];
  const minimum = visibleSimilarities.length ? Math.min(...visibleSimilarities) : 0;
  const maximum = visibleSimilarities.length ? Math.max(...visibleSimilarities) : 1;
  const range = Math.max(0.001, maximum - minimum);

  return (
    <div className="board-shell">
      <div className="board" aria-label="Игровое поле">
        {cards.map((card, index) => {
          const ranking = rankingByIndex.get(index);
          const heat = ranking ? Math.max(0.08, (ranking.similarity - minimum) / range) : 0;
          const roleVisible = card.revealed || showKey;
          const canChoose = interactive && !card.revealed;
          const style = {
            "--card-order": index,
            "--signal": showTrace ? heat : 0
          } as CSSProperties;
          return (
            <button
              type="button"
              className={`word-card${card.revealed ? " is-revealed" : ""}${
                showTrace && ranking ? " has-signal" : ""
              }`}
              data-role={roleVisible ? card.role : "hidden"}
              data-key-role={showKey && !card.revealed ? card.role : undefined}
              disabled={!canChoose}
              onClick={() => onCardClick(index)}
              style={style}
              aria-label={`${card.word}${roleVisible ? `, ${ROLE_LABELS[card.role]}` : ""}`}
            >
              {showTrace ? <span className="word-card__index">{String(index + 1).padStart(2, "0")}</span> : null}
              {showTrace && ranking ? (
                <span className="word-card__rank" title="Ранг по близости к подсказке">
                  #{ranking.rank}
                </span>
              ) : null}
              <span className="word-card__word">{card.word}</span>
              <span className="word-card__signal" aria-hidden="true" />
              {canChoose ? <span className={`word-card__choose is-${currentTeam}`}>выбрать</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
