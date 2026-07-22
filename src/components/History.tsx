import { clueRemaining } from "../domain/clues.js";
import type { Team, TurnRecord } from "../domain/types.js";

interface HistoryProps {
  history: TurnRecord[];
}

const END_LABELS: Record<TurnRecord["endedBy"], string> = {
  limit: "завершено",
  "wrong-card": "ошибка",
  assassin: "убийца",
  victory: "победа",
  stopped: "стоп"
};

function TeamClues({
  team,
  records
}: {
  team: Team;
  records: TurnRecord[];
}) {
  return (
    <section className={`team-history is-${team}`}>
      <header>
        <span className={`team-beacon is-${team}`} />
        <strong>{team === "red" ? "Красные" : "Синие"}</strong>
        <span>{records.filter((record) => clueRemaining(record) > 0).length} открыто</span>
      </header>
      {records.length ? (
        <ol>
          {[...records].reverse().map((record) => {
            const remaining = clueRemaining(record);
            return (
            <li className={remaining > 0 ? "has-remaining" : "is-closed"} key={`${record.turn}-${record.team}`}>
              <div className="history-clue"><strong>{record.clue}</strong></div>
              <div className="clue-memory is-readonly" aria-label={`Осталось ${remaining} из ${record.number} слов`}>
                <strong>{remaining}<span>/{record.number}</span></strong>
              </div>
              <div className="history-guesses">
                {record.guesses.length ? record.guesses.map((guess) => (
                  <span className={`is-${guess.role}`} key={guess.index}><i />{guess.word}</span>
                )) : <span>без ответа</span>}
              </div>
              <small>Ход {record.turn} · {END_LABELS[record.endedBy]}</small>
            </li>
          );})}
        </ol>
      ) : <p>Подсказок пока не было.</p>}
    </section>
  );
}

export function History({ history }: HistoryProps) {
  const red = history.filter((record) => record.team === "red");
  const blue = history.filter((record) => record.team === "blue");
  return (
    <section className="game-history" aria-labelledby="history-title">
      <div className="game-history__title"><h2 id="history-title">Подсказки</h2></div>
      <div className="history-columns">
        <TeamClues team="red" records={red} />
        <TeamClues team="blue" records={blue} />
      </div>
    </section>
  );
}
