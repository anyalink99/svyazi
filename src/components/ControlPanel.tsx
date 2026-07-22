import type { FormEvent } from "react";
import type {
  ClueAnalysis,
  GuessPlan,
  OperativeProfile,
  SemanticMetadata,
  Team
} from "../domain/types.js";

export type PlayMode = "ai-vs-ai" | "human-operative" | "human-spymaster";

interface PrimaryAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ControlPanelProps {
  model: SemanticMetadata | null;
  mode: PlayMode;
  onModeChange: (mode: PlayMode) => void;
  profile: OperativeProfile;
  onProfileChange: (profile: OperativeProfile) => void;
  team: Team;
  winner: Team | null;
  clue: ClueAnalysis | null;
  lastPlan: GuessPlan | null;
  loading: boolean;
  showTrace: boolean;
  onShowTraceChange: (value: boolean) => void;
  showKey: boolean;
  onShowKeyChange: (value: boolean) => void;
  autoPlay: boolean;
  onAutoPlayChange: (value: boolean) => void;
  primaryAction: PrimaryAction;
  onNewGame: () => void;
  manualClue: string;
  manualNumber: number;
  onManualClueChange: (value: string) => void;
  onManualNumberChange: (value: number) => void;
  onManualSubmit: () => void;
}

const MODES: Array<{ id: PlayMode; label: string; short: string }> = [
  { id: "ai-vs-ai", label: "ИИ против ИИ", short: "наблюдать" },
  { id: "human-operative", label: "Я оперативник", short: "угадывать" },
  { id: "human-spymaster", label: "Я ведущий", short: "объяснять" }
];

const PROFILE_LABELS: Record<OperativeProfile, string> = {
  cautious: "осторожный",
  balanced: "сбалансированный",
  daring: "рискованный"
};

export function ControlPanel(props: ControlPanelProps) {
  const canSeePrivateAnalysis = props.mode !== "human-operative";

  function submit(event: FormEvent) {
    event.preventDefault();
    props.onManualSubmit();
  }

  return (
    <aside className="control-panel" aria-label="Пульт игры">
      <div className="model-strip">
        <span className={`model-strip__light${props.model?.kind === "navec" ? " is-ready" : ""}`} />
        <span>
          <small>семантический двигатель</small>
          <strong>{props.model?.kind === "navec" ? "Navec локально" : "Демо-словарь"}</strong>
        </span>
        <span className="model-strip__size">
          {props.model ? props.model.vocabularySize.toLocaleString("ru-RU") : "—"}
        </span>
      </div>

      <div className="mode-switcher" role="tablist" aria-label="Режим игры">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={props.mode === item.id}
            className={props.mode === item.id ? "is-active" : ""}
            onClick={() => props.onModeChange(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.short}</span>
          </button>
        ))}
      </div>

      <section className="clue-console" aria-live="polite">
        <div className="clue-console__topline">
          <span className="eyebrow">Канал подсказки</span>
          <span className={`turn-label is-${props.team}`}>
            {props.winner ? `победа ${props.winner === "red" ? "красных" : "синих"}` : `ход ${props.team === "red" ? "красных" : "синих"}`}
          </span>
        </div>
        <div className={`clue-dial${props.loading ? " is-searching" : ""}`}>
          <div className="clue-dial__word">{props.loading ? "поиск…" : props.clue?.word ?? "тишина"}</div>
          <div className="clue-dial__number" aria-label={`Количество слов: ${props.clue?.number ?? 0}`}>
            <span>{props.clue?.number ?? "—"}</span>
          </div>
        </div>
        {props.clue ? (
          <div className="clue-meta">
            <span>уверенность {Math.round(props.clue.confidence * 100)}%</span>
            {canSeePrivateAnalysis ? <span>зазор {props.clue.margin.toFixed(3)}</span> : null}
          </div>
        ) : (
          <p className="clue-console__hint">Запустите ход — ведущий найдёт связь между словами.</p>
        )}
      </section>

      {props.mode === "human-spymaster" && !props.winner && props.team === "red" ? (
        <form className="manual-clue" onSubmit={submit}>
          <label htmlFor="manual-clue">Ваша однословная подсказка</label>
          <div className="manual-clue__row">
            <input
              id="manual-clue"
              value={props.manualClue}
              onChange={(event) => props.onManualClueChange(event.target.value)}
              placeholder="например, космос"
              autoComplete="off"
              disabled={props.loading}
            />
            <select
              aria-label="Количество слов"
              value={props.manualNumber}
              onChange={(event) => props.onManualNumberChange(Number(event.target.value))}
              disabled={props.loading}
            >
              {[1, 2, 3, 4, 5].map((number) => <option key={number} value={number}>{number}</option>)}
            </select>
          </div>
          <button className="button button--primary button--wide" disabled={props.loading || !props.manualClue.trim()}>
            Передать оперативнику
          </button>
        </form>
      ) : (
        <button
          className="button button--primary button--wide"
          type="button"
          disabled={props.primaryAction.disabled || props.loading}
          onClick={props.primaryAction.onClick}
        >
          {props.primaryAction.label}
        </button>
      )}

      {props.mode === "ai-vs-ai" ? (
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.autoPlay}
            onChange={(event) => props.onAutoPlayChange(event.target.checked)}
          />
          <span>Автопилот до конца партии</span>
        </label>
      ) : null}

      <div className="panel-settings">
        <label>
          <span>Характер оперативника</span>
          <select value={props.profile} onChange={(event) => props.onProfileChange(event.target.value as OperativeProfile)}>
            {Object.entries(PROFILE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={props.showTrace} onChange={(event) => props.onShowTraceChange(event.target.checked)} />
          <span>Семантический след</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={props.showKey} onChange={(event) => props.onShowKeyChange(event.target.checked)} />
          <span>Показать ключ поля</span>
        </label>
      </div>

      {props.clue && props.showTrace ? (
        <section className="ranking-list" aria-label="Близость карточек к подсказке">
          <div className="ranking-list__heading">
            <span>Ближайшие карточки</span>
            {canSeePrivateAnalysis ? <small>{props.clue.candidateCount} кандидатов</small> : null}
          </div>
          <ol>
            {props.clue.rankings.slice(0, 6).map((item) => (
              <li key={item.index}>
                <span>{item.rank}</span>
                <strong>{item.word}</strong>
                <code>{item.similarity.toFixed(3)}</code>
              </li>
            ))}
          </ol>
          {props.lastPlan?.stopReason ? <p className="ranking-list__note">Оперативник остановился: {props.lastPlan.stopReason}</p> : null}
        </section>
      ) : null}

      <button className="text-button" type="button" onClick={props.onNewGame}>Сдать поле и начать заново</button>
    </aside>
  );
}
