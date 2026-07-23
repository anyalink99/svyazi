import type { CSSProperties } from "react";
import type { CardState, ClueAnalysis, Team } from "../domain/types.js";

interface BoardProps {
  cards: CardState[];
  clue: ClueAnalysis | null;
  showKey: boolean;
  gameOver: boolean;
  showTrace: boolean;
  interactive: boolean;
  currentTeam: Team;
  voteMarkers: BoardVoteMarker[];
  localSeatId: string | null;
  onCardClick: (index: number) => void;
}

export interface BoardVoteMarker {
  seatId: string;
  name: string;
  team: Team;
  index: number;
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
  gameOver,
  showTrace,
  interactive,
  currentTeam,
  voteMarkers,
  localSeatId,
  onCardClick
}: BoardProps) {
  const rankingByIndex = new Map(clue?.rankings.map((ranking) => [ranking.index, ranking]) ?? []);
  const visibleSimilarities = clue?.rankings.map((ranking) => ranking.similarity) ?? [];
  const minimum = visibleSimilarities.length ? Math.min(...visibleSimilarities) : 0;
  const maximum = visibleSimilarities.length ? Math.max(...visibleSimilarities) : 1;
  const range = Math.max(0.001, maximum - minimum);

  return (
    <div className="board-shell">
      <div className={`board${gameOver ? " is-final-key" : ""}`} aria-label={gameOver ? "Финальный ключ" : "Игровое поле"}>
        {cards.map((card, index) => {
          const ranking = rankingByIndex.get(index);
          const heat = ranking ? Math.max(0.08, (ranking.similarity - minimum) / range) : 0;
          const roleVisible = card.revealed || showKey || gameOver;
          const canChoose = interactive && !card.revealed;
          const cardVotes = voteMarkers.filter((vote) => vote.index === index);
          const locallySelected = cardVotes.some((vote) => vote.seatId === localSeatId);
          const style = {
            "--card-order": index,
            "--signal": showTrace ? heat : 0
          } as CSSProperties;
          return (
            <button
              key={`${card.word}-${index}`}
              type="button"
              className={`word-card${card.revealed ? " is-revealed" : ""}${cardVotes.length ? ` has-votes is-voted-${currentTeam}` : ""}${locallySelected ? " is-local-vote" : ""}${
                showTrace && ranking ? " has-signal" : ""
              }`}
              data-role={roleVisible ? card.role : "hidden"}
              data-key-role={(showKey || gameOver) && !card.revealed ? card.role : undefined}
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
              {cardVotes.length ? (
                <span className="word-card__votes" aria-label={`Выбрали: ${cardVotes.map((vote) => vote.name).join(", ")}`}>
                  {cardVotes.map((vote) => (
                    <i className={`is-${vote.team}${vote.seatId === localSeatId ? " is-local" : ""}`} key={vote.seatId} title={vote.name}>
                      {vote.name.trim().slice(0, 1).toLocaleUpperCase("ru-RU")}
                    </i>
                  ))}
                </span>
              ) : null}
              {canChoose ? <span className={`word-card__choose is-${currentTeam}`}>выбрать</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
