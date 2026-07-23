import { clueRemaining } from "../domain/clues.js";
import type { TurnRecord } from "../domain/types.js";

interface HistoryProps {
  history: TurnRecord[];
  gameOver: boolean;
}

const END_LABELS: Record<TurnRecord["endedBy"], string> = {
  limit: "завершено",
  "wrong-card": "ошибка",
  assassin: "убийца",
  victory: "победа",
  stopped: "стоп"
};

export function History({ history, gameOver }: HistoryProps) {
  const records = [...history].reverse();
  return (
    <section className="game-history" aria-labelledby="history-title">
      <div className="game-history__title"><h2 id="history-title">Подсказки</h2></div>
      {records.length ? (
        <ol className="history-feed">
          {records.map((record) => {
            const remaining = clueRemaining(record);
            return (
              <li
                className={`history-record is-${record.team}${remaining > 0 ? " has-remaining" : " is-closed"}`}
                key={`${record.turn}-${record.team}`}
              >
                <div className="history-record__headline">
                  <span className={`team-beacon is-${record.team}`} aria-hidden="true" />
                  <div className="history-clue"><strong>{record.clue}</strong></div>
                  <div className="clue-memory is-readonly" aria-label={`Осталось ${remaining} из ${record.number} слов`}>
                    <strong>{remaining}<span>/{record.number}</span></strong>
                  </div>
                </div>
                <div className="history-guesses">
                  {record.guesses.length ? record.guesses.map((guess) => (
                    <span className={`is-${guess.role}`} key={guess.index}><i />{guess.word}</span>
                  )) : <span>без ответа</span>}
                </div>
                {gameOver && record.clueGiver === "ai" && record.targetWords.length ? (
                  <div className="history-intent">
                    <span>Замысел ИИ</span>
                    <div>{record.targetWords.map((word) => <b key={word}>{word}</b>)}</div>
                  </div>
                ) : null}
                <small>{record.team === "red" ? "Красные" : "Синие"} · ход {record.turn} · {END_LABELS[record.endedBy]}</small>
              </li>
            );
          })}
        </ol>
      ) : <p className="history-empty">Подсказок пока не было.</p>}
    </section>
  );
}
