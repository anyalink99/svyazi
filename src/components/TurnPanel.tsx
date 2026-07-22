import type { FormEvent } from "react";
import { clueRemaining } from "../domain/clues.js";
import type { TeamAiTuning, TeamSeats } from "../domain/multiplayer.js";
import { operativeNames } from "../domain/setup.js";
import type { ClueAmbition, ClueAnalysis, OperativeProfile, Team, TurnRecord } from "../domain/types.js";
import { ChoiceSelect, type ChoiceOption } from "./ChoiceSelect.js";

export type GamePhase = "clue" | "guess" | "result";

export interface VoteStatus {
  cast: number;
  total: number;
  message: string | null;
  finishCast: number;
  localFinishVoted: boolean;
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
  canControlSystem: boolean;
  canSubmitHumanClue: boolean;
  canFinishHumanGuess: boolean;
  canEditTuning: boolean;
  hostAvailable: boolean;
  lobbyReady: boolean;
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
  { value: "focused", label: "Точечно · ≈1,3" },
  { value: "balanced", label: "Взвешенно · ≈2,3" },
  { value: "broad", label: "Широко · ≈3,3" }
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
        <div className={props.phase === "clue" ? "is-current" : "is-done"}>
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
                  const remaining = spymaster.controller === "ai" ? clueRemaining(record) : draftRemaining(record);
                  return (
                    <div className="clue-carryover__item" key={`${record.team}:${record.turn}`}>
                      <span>{record.clue}</span>
                      <div className={spymaster.controller === "ai" ? "is-readonly" : ""} aria-label={`Осталось ${remaining} из ${record.number} слов`}>
                        {spymaster.controller === "human" ? <button type="button" disabled={!props.canSubmitHumanClue || props.loading || remaining === 0} onClick={() => props.onRemainingDraftChange(record, remaining - 1)}>−</button> : null}
                        <strong>{remaining}<i>/{record.number}</i></strong>
                        {spymaster.controller === "human" ? <button type="button" disabled={!props.canSubmitHumanClue || props.loading || remaining >= record.number} onClick={() => props.onRemainingDraftChange(record, remaining + 1)}>+</button> : null}
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
                <ChoiceSelect disabled={!props.canEditTuning} value={props.tuning.ambition} options={AMBITION_OPTIONS} ariaLabel="Охват подсказки" onChange={(ambition) => props.onTuningChange({ ambition })} />
              </div>
              <button className="game-action" type="button" aria-busy={props.loading} disabled={props.loading || !props.canControlSystem || !props.hostAvailable} onClick={props.onRequestClue}>
                {!props.hostAvailable ? "Связь с хозяином потеряна" : !props.lobbyReady ? "Ждём игроков" : props.loading ? "Ведущий думает…" : props.canControlSystem ? "Получить подсказку" : "Хозяин запускает ведущего"}
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
                    disabled={props.loading || !props.canSubmitHumanClue || !props.hostAvailable}
                    autoFocus={props.canSubmitHumanClue}
                  />
                </label>
                <div className="clue-field">
                  <span>Количество</span>
                  <ChoiceSelect disabled={!props.canSubmitHumanClue || props.loading || !props.hostAvailable} value={String(props.manualNumber)} options={NUMBER_OPTIONS} ariaLabel="Количество слов" onChange={(value) => props.onManualNumberChange(Number(value))} />
                </div>
              </div>
              <small className="clue-vocabulary-note">
                {props.allowUnknownClue
                  ? "В команде нет ИИ: подсказка не обязана быть в словаре Navec."
                  : "В команде есть ИИ: подсказка должна быть знакома семантической модели."}
              </small>
              <button className="game-action" aria-busy={props.loading} disabled={props.loading || !props.manualClue.trim() || !props.canSubmitHumanClue || !props.hostAvailable}>
                {!props.hostAvailable ? "Связь с хозяином потеряна" : !props.lobbyReady ? "Ждём игроков" : props.loading ? "Проверяю слово…" : props.canSubmitHumanClue ? "Передать подсказку" : "Ожидаем ведущего"}
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
          <h2>{operativeNames(props.seats, props.team)}</h2>
          {allOperativesAi ? (
            <>
              <div className="turn-tuning">
                <span>Риск ответов</span>
                <ChoiceSelect disabled={!props.canEditTuning} value={props.tuning.risk} options={RISK_OPTIONS} ariaLabel="Риск ответов" onChange={(risk) => props.onTuningChange({ risk })} />
              </div>
              <p>ИИ сам решит, сколько карточек открыть. Жёсткого лимита ответов нет.</p>
              <button className="game-action" type="button" aria-busy={props.loading} disabled={props.loading || !props.canControlSystem || !props.hostAvailable} onClick={props.onStartAiGuess}>
                {!props.hostAvailable ? "Связь с хозяином потеряна" : !props.lobbyReady ? "Ждём игроков" : props.loading ? "ИИ выбирает…" : props.canControlSystem ? "Начать ответы ИИ" : "Хозяин запускает оперативников"}
              </button>
            </>
          ) : (
            <>
              <p>Открывайте связанные карточки, пока уверены. Можно остановиться в любой момент — лимита ответов нет.</p>
              {hasAiOperatives ? (
                <div className="turn-tuning is-compact">
                  <span>Риск голоса ИИ</span>
                  <ChoiceSelect disabled={!props.canEditTuning} value={props.tuning.risk} options={RISK_OPTIONS} ariaLabel="Риск голоса ИИ" onChange={(risk) => props.onTuningChange({ risk })} />
                </div>
              ) : null}
              {props.voteStatus && props.voteStatus.total > 1 ? (
                <div className={`vote-status${props.voteStatus.message ? " has-message" : ""}`}>
                  <span>Согласование команды</span>
                  <strong>{props.voteStatus.cast}/{props.voteStatus.total}</strong>
                  <small>{props.voteStatus.message ?? (props.voteStatus.cast ? "Выборы отмечены на карточках" : "Каждый оперативник выбирает карточку")}</small>
                </div>
              ) : (
                <div className="guess-progress"><span>Открыто в этом ходу</span><strong>{props.pickedCount}</strong></div>
              )}
              <button className={`game-action game-action--quiet${props.voteStatus?.localFinishVoted ? " is-voted" : ""}`} type="button" aria-busy={props.loading} disabled={props.loading || !props.canFinishHumanGuess || !props.hostAvailable} onClick={props.onFinishHumanGuess}>
                {!props.hostAvailable
                  ? "Связь с хозяином потеряна"
                  : !props.lobbyReady
                    ? "Ждём игроков"
                    : !props.canFinishHumanGuess
                      ? "Ожидаем оперативника"
                      : props.voteStatus?.localFinishVoted
                        ? `Отменить остановку · ${props.voteStatus.finishCast}/${props.voteStatus.total}`
                        : `Остановиться · ${props.voteStatus?.finishCast ?? 0}/${props.voteStatus?.total ?? 1}`}
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
            <button className="game-action" type="button" disabled={!props.canControlSystem || !props.hostAvailable} onClick={props.onNewGame}>{!props.lobbyReady ? "Ждём игроков" : props.canControlSystem ? "Сыграть ещё раз" : "Хозяин создаёт новую партию"}</button>
          ) : (
            <button className="game-action" type="button" disabled={!props.canControlSystem || !props.hostAvailable} onClick={props.onContinue}>{!props.lobbyReady ? "Ждём игроков" : props.canControlSystem ? `Передать ход ${TEAM_NAMES[props.nextTeam]}` : "Хозяин передаёт ход"}</button>
          )}
        </section>
      ) : null}
    </aside>
  );
}
