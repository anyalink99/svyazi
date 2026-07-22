import type { FormEvent } from "react";
import { clueRemaining } from "../domain/clues.js";
import type { TeamAiTuning, TeamSeats } from "../domain/multiplayer.js";
import { operativeNames } from "../domain/setup.js";
import type { ClueAmbition, ClueAnalysis, OperativeProfile, Team, TurnRecord } from "../domain/types.js";
import { ChoiceSelect, type ChoiceOption } from "./ChoiceSelect.js";

export type GamePhase = "clue" | "guess" | "result";

export interface VoteStatus {
  currentVoterName: string | null;
  cast: number;
  total: number;
  message: string | null;
}

interface TurnPanelProps {
  phase: GamePhase;
  team: Team;
  nextTeam: Team;
  seats: TeamSeats;
  tuning: TeamAiTuning;
  clue: ClueAnalysis | null;
  result: TurnRecord | null;
  winner: Team | null;
  loading: boolean;
  pickedCount: number;
  manualClue: string;
  manualNumber: number;
  allowUnknownClue: boolean;
  previousClues: TurnRecord[];
  remainingDraft: Record<string, number>;
  voteStatus: VoteStatus | null;
  onManualClueChange: (value: string) => void;
  onManualNumberChange: (value: number) => void;
  onTuningChange: (patch: Partial<TeamAiTuning>) => void;
  onRemainingDraftChange: (record: TurnRecord, remaining: number) => void;
  onSubmitClue: () => void;
  onRequestClue: () => void;
  onStartAiGuess: () => void;
  onFinishHumanGuess: () => void;
  onContinue: () => void;
  onNewGame: () => void;
}

const TEAM_NAMES: Record<Team, string> = { red: "красных", blue: "синих" };

const AMBITION_OPTIONS: ChoiceOption<ClueAmbition>[] = [
  { value: "focused", label: "Точечно · 1–2" },
  { value: "balanced", label: "Умеренно · до 4" },
  { value: "broad", label: "Широко · до 8" }
];

const RISK_OPTIONS: ChoiceOption<OperativeProfile>[] = [
  { value: "cautious", label: "Осторожно" },
  { value: "balanced", label: "Взвешенно" },
  { value: "daring", label: "Рискованно" }
];

const NUMBER_OPTIONS: ChoiceOption<string>[] = Array.from({ length: 9 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1)
}));

function resultCopy(record: TurnRecord | null): string {
  if (!record) return "Ход завершён.";
  if (record.endedBy === "assassin") return "Открыт убийца — партия окончена.";
  if (record.endedBy === "victory") return "Открыт последний агент команды.";
  if (record.endedBy === "wrong-card") return "Открыта чужая или мирная карточка.";
  if (record.endedBy === "stopped") return "Команда решила остановиться.";
  return "Ход завершён.";
}

export function TurnPanel(props: TurnPanelProps) {
  const spymaster = props.seats[props.team].spymaster;
  const operatives = props.seats[props.team].operatives;
  const allOperativesAi = operatives.every((seat) => seat.controller === "ai");
  const hasAiOperatives = operatives.some((seat) => seat.controller === "ai");
  const previousClues = props.previousClues.filter((record) => record.team === props.team && clueRemaining(record) > 0);

  function draftRemaining(record: TurnRecord) {
    return props.remainingDraft[`${record.team}:${record.turn}`] ?? clueRemaining(record);
  }

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
          {previousClues.length ? (
            <div className="clue-carryover">
              <strong>Остаток прошлых подсказок</strong>
              <div>
                {previousClues.map((record) => {
                  const remaining = draftRemaining(record);
                  return (
                    <div className="clue-carryover__item" key={`${record.team}:${record.turn}`}>
                      <span>{record.clue}</span>
                      <div aria-label={`Осталось ${remaining} из ${record.number} слов`}>
                        <button type="button" disabled={remaining === 0} onClick={() => props.onRemainingDraftChange(record, remaining - 1)}>−</button>
                        <strong>{remaining}<i>/{record.number}</i></strong>
                        <button type="button" disabled={remaining >= record.number} onClick={() => props.onRemainingDraftChange(record, remaining + 1)}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {spymaster.controller === "ai" ? (
            <>
              <div className="turn-tuning">
                <span>Охват подсказки</span>
                <ChoiceSelect value={props.tuning.ambition} options={AMBITION_OPTIONS} ariaLabel="Охват подсказки" onChange={(ambition) => props.onTuningChange({ ambition })} />
              </div>
              <button className="game-action" type="button" aria-busy={props.loading} disabled={props.loading} onClick={props.onRequestClue}>
                {props.loading ? "Ведущий думает…" : "Получить подсказку"}
              </button>
            </>
          ) : (
            <form className="clue-form" onSubmit={submit}>
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
                <div className="clue-field">
                  <span>Количество</span>
                  <ChoiceSelect value={String(props.manualNumber)} options={NUMBER_OPTIONS} ariaLabel="Количество слов" onChange={(value) => props.onManualNumberChange(Number(value))} />
                </div>
              </div>
              <small className="clue-vocabulary-note">
                {props.allowUnknownClue
                  ? "В команде нет ИИ: подсказка не обязана быть в словаре Navec."
                  : "В команде есть ИИ: подсказка должна быть знакома семантической модели."}
              </small>
              <button className="game-action" aria-busy={props.loading} disabled={props.loading || !props.manualClue.trim()}>
                {props.loading ? "Проверяю слово…" : "Передать подсказку"}
              </button>
            </form>
          )}
        </section>
      ) : null}

      {props.phase === "guess" && props.clue ? (
        <section className="turn-panel__stage" key="guess">
          <span className="stage-kicker">Теперь отвечает команда</span>
          <div className="active-clue">
            <strong>{props.clue.word}</strong>
            <span><b>{props.clue.number}</b></span>
          </div>
          <h2>{props.voteStatus?.currentVoterName ?? operativeNames(props.seats, props.team)}</h2>
          {allOperativesAi ? (
            <>
              <div className="turn-tuning">
                <span>Риск ответов</span>
                <ChoiceSelect value={props.tuning.risk} options={RISK_OPTIONS} ariaLabel="Риск ответов" onChange={(risk) => props.onTuningChange({ risk })} />
              </div>
              <p>ИИ сам решит, сколько карточек открыть. Жёсткого лимита ответов нет.</p>
              <button className="game-action" type="button" aria-busy={props.loading} disabled={props.loading} onClick={props.onStartAiGuess}>
                {props.loading ? "ИИ выбирает…" : "Начать ответы ИИ"}
              </button>
            </>
          ) : (
            <>
              <p>Открывайте связанные карточки, пока уверены. Можно остановиться в любой момент — лимита ответов нет.</p>
              {hasAiOperatives ? (
                <div className="turn-tuning is-compact">
                  <span>Риск голоса ИИ</span>
                  <ChoiceSelect value={props.tuning.risk} options={RISK_OPTIONS} ariaLabel="Риск голоса ИИ" onChange={(risk) => props.onTuningChange({ risk })} />
                </div>
              ) : null}
              {props.voteStatus && props.voteStatus.total > 1 ? (
                <div className={`vote-status${props.voteStatus.message ? " has-message" : ""}`}>
                  <span>Согласование команды</span>
                  <strong>{props.voteStatus.cast}/{props.voteStatus.total}</strong>
                  <small>{props.voteStatus.message ?? `Сейчас выбирает: ${props.voteStatus.currentVoterName}`}</small>
                </div>
              ) : (
                <div className="guess-progress"><span>Открыто в этом ходу</span><strong>{props.pickedCount}</strong></div>
              )}
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
            <button className="game-action" type="button" onClick={props.onNewGame}>Сыграть ещё раз</button>
          ) : (
            <button className="game-action" type="button" onClick={props.onContinue}>Передать ход {TEAM_NAMES[props.nextTeam]}</button>
          )}
        </section>
      ) : null}
    </aside>
  );
}
