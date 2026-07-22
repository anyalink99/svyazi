import type { Team, TurnRecord } from "../domain/types.js";

interface HistoryProps {
  history: TurnRecord[];
}

const END_LABELS: Record<TurnRecord["endedBy"], string> = {
  limit: "лимит",
  "wrong-card": "ошибка",
  assassin: "убийца",
  victory: "победа",
  stopped: "стоп"
};

function TeamHistory({ team, records }: { team: Team; records: TurnRecord[] }) {
  return (
    <section className={`team-history is-${team}`}>
      <header>
        <span className={`team-beacon is-${team}`} />
        <strong>{team === "red" ? "Красные" : "Синие"}</strong>
        <span>{records.length} {records.length === 1 ? "ход" : "ходов"}</span>
      </header>
      {records.length ? (
        <ol>
          {[...records].reverse().map((record) => (
            <li key={`${record.turn}-${record.team}`}>
              <div className="history-clue"><strong>{record.clue}</strong><span>{record.number}</span></div>
              <div className="history-guesses">
                {record.guesses.length ? record.guesses.map((guess) => (
                  <span className={`is-${guess.role}`} key={guess.index}><i />{guess.word}</span>
                )) : <span>без ответа</span>}
              </div>
              <small>Ход {record.turn} · {END_LABELS[record.endedBy]}</small>
            </li>
          ))}
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
      <div className="game-history__title"><span>Журнал партии</span><h2 id="history-title">Подсказки обеих команд</h2></div>
      <div className="history-columns">
        <TeamHistory team="red" records={red} />
        <TeamHistory team="blue" records={blue} />
      </div>
    </section>
  );
}
