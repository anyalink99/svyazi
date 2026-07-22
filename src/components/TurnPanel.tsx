import type { FormEvent } from "react";
import type { TeamSeats } from "../domain/multiplayer.js";
import type { ClueAnalysis, Team, TurnRecord } from "../domain/types.js";

export type GamePhase = "clue" | "guess" | "result";

interface TurnPanelProps {
  phase: GamePhase;
  team: Team;
  nextTeam: Team;
  seats: TeamSeats;
  clue: ClueAnalysis | null;
  result: TurnRecord | null;
  winner: Team | null;
  loading: boolean;
  pickedCount: number;
  manualClue: string;
  manualNumber: number;
  onManualClueChange: (value: string) => void;
  onManualNumberChange: (value: number) => void;
  onSubmitClue: () => void;
  onRequestClue: () => void;
  onStartAiGuess: () => void;
  onFinishHumanGuess: () => void;
  onContinue: () => void;
  onNewGame: () => void;
}

const TEAM_NAMES: Record<Team, string> = { red: "красных", blue: "синих" };

function resultCopy(record: TurnRecord | null): string {
  if (!record) return "Ход завершён.";
  if (record.endedBy === "assassin") return "Открыт убийца — партия окончена.";
  if (record.endedBy === "victory") return "Открыт последний агент команды.";
  if (record.endedBy === "wrong-card") return "Открыта чужая или мирная карточка.";
  if (record.endedBy === "stopped") return "Оперативники решили остановиться.";
  return "Лимит ответов исчерпан.";
}

export function TurnPanel(props: TurnPanelProps) {
  const spymaster = props.seats[props.team].spymaster;
  const operative = props.seats[props.team].operative;

  function submit(event: FormEvent) {
    event.preventDefault();
    props.onSubmitClue();
  }

  return (
    <aside className={`turn-panel is-${props.team}`} aria-live="polite">
      <div className="phase-rail" aria-label="Этапы хода">
        <div className={props.phase === "clue" ? "is-current" : props.phase !== "clue" ? "is-done" : ""}>
          <span>1</span><strong>Подсказка</strong>
        </div>
        <i aria-hidden="true" />
        <div className={props.phase === "guess" ? "is-current" : props.phase === "result" ? "is-done" : ""}>
          <span>2</span><strong>Ответы</strong>
        </div>
        <i aria-hidden="true" />
        <div className={props.phase === "result" ? "is-current" : ""}>
          <span>3</span><strong>Итог</strong>
        </div>
      </div>

      <div className="turn-panel__teamline">
        <span className={`team-beacon is-${props.team}`} />
        Ход {TEAM_NAMES[props.team]}
      </div>

      {props.phase === "clue" ? (
        <section className="turn-panel__stage" key="clue">
          <span className="stage-kicker">Сейчас говорит ведущий</span>
          <h2>{spymaster.name}</h2>
          {spymaster.controller === "ai" ? (
            <>
              <p>ИИ видит ключ поля и подберёт одно слово, которое связывает агентов команды.</p>
              <small>Карточки откроются для выбора на следующем этапе.</small>
              <button className="game-action" type="button" aria-busy={props.loading} disabled={props.loading} onClick={props.onRequestClue}>
                {props.loading ? "Ведущий думает…" : "Получить подсказку"}
              </button>
            </>
          ) : (
            <form className="clue-form" onSubmit={submit}>
              <p>Ключ открыт только на этом этапе. Назовите одно слово и число связанных карточек.</p>
              <div className="clue-form__fields">
                <label>
                  <span>Подсказка</span>
                  <input
                    value={props.manualClue}
                    onChange={(event) => props.onManualClueChange(event.target.value)}
                    placeholder="Например, космос"
                    autoComplete="off"
                    disabled={props.loading}
                    autoFocus
                  />
                </label>
                <label>
                  <span>Количество</span>
                  <select value={props.manualNumber} onChange={(event) => props.onManualNumberChange(Number(event.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => <option key={number}>{number}</option>)}
                  </select>
                </label>
              </div>
              <button className="game-action" aria-busy={props.loading} disabled={props.loading || !props.manualClue.trim()}>
                {props.loading ? "Проверяю слово…" : "Передать подсказку"}
              </button>
            </form>
          )}
        </section>
      ) : null}

      {props.phase === "guess" && props.clue ? (
        <section className="turn-panel__stage" key="guess">
          <span className="stage-kicker">Теперь отвечают оперативники</span>
          <div className="active-clue">
            <strong>{props.clue.word}</strong>
            <span><b>{props.clue.number}</b></span>
          </div>
          <h2>{operative.name}</h2>
          {operative.controller === "ai" ? (
            <>
              <p>Подсказка передана. ИИ не видит ключ и будет открывать карточки по семантической близости.</p>
              <button className="game-action" type="button" aria-busy={props.loading} disabled={props.loading} onClick={props.onStartAiGuess}>
                {props.loading ? "ИИ выбирает…" : "Начать ответы ИИ"}
              </button>
            </>
          ) : (
            <>
              <p>Нажимайте карточки на поле. Можно открыть до {props.clue.number + 1} или закончить раньше.</p>
              <div className="guess-progress">
                <span>Открыто в этом ходу</span>
                <strong>{props.pickedCount} / {props.clue.number + 1}</strong>
              </div>
              <button className="game-action game-action--quiet" type="button" aria-busy={props.loading} disabled={props.loading} onClick={props.onFinishHumanGuess}>
                {props.pickedCount ? "Закончить ход" : "Пропустить ход"}
              </button>
            </>
          )}
        </section>
      ) : null}

      {props.phase === "result" ? (
        <section className="turn-panel__stage result-stage" key="result">
          <span className="stage-kicker">Ход завершён</span>
          <h2>{resultCopy(props.result)}</h2>
          {props.result ? (
            <div className="result-clue">
              <span>{props.result.clue} — {props.result.number}</span>
              <div>
                {props.result.guesses.length
                  ? props.result.guesses.map((guess) => (
                      <span className={`guess-chip is-${guess.role}`} key={guess.index}>{guess.word}</span>
                    ))
                  : <span className="guess-chip">без ответа</span>}
              </div>
            </div>
          ) : null}
          {props.winner ? (
            <button className="game-action" type="button" onClick={props.onNewGame}>
              Сыграть ещё раз
            </button>
          ) : (
            <button className="game-action" type="button" onClick={props.onContinue}>
              Передать ход {TEAM_NAMES[props.nextTeam]}
            </button>
          )}
        </section>
      ) : null}
    </aside>
  );
}
