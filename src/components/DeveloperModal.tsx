import type { ClueAnalysis, GuessPlan, OperativeProfile, SemanticMetadata } from "../domain/types.js";
import { SimulationPanel } from "./SimulationPanel.js";
import { useModalPresence } from "../hooks/useModalPresence.js";

interface DeveloperModalProps {
  open: boolean;
  model: SemanticMetadata | null;
  clue: ClueAnalysis | null;
  lastPlan: GuessPlan | null;
  profile: OperativeProfile;
  onProfileChange: (value: OperativeProfile) => void;
  showTrace: boolean;
  onShowTraceChange: (value: boolean) => void;
  showKey: boolean;
  onShowKeyChange: (value: boolean) => void;
  onNewGame: () => void;
  onClose: () => void;
}

export function DeveloperModal(props: DeveloperModalProps) {
  const presence = useModalPresence(props.open, props.onClose);
  if (!presence.mounted) return null;
  return (
    <div className={`modal-backdrop${presence.visible ? " is-visible" : ""}`} role="presentation" onMouseDown={props.onClose}>
      <section ref={presence.dialogRef} tabIndex={-1} className="game-modal developer-modal" role="dialog" aria-modal="true" aria-labelledby="developer-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div><span className="stage-kicker">Дополнительные инструменты</span><h2 id="developer-title">Лаборатория</h2></div>
          <button type="button" onClick={props.onClose} aria-label="Закрыть">×</button>
        </header>

        <p className="lab-intro">Здесь сохранены дополнительные инструменты: модель, характер ИИ, ключ поля, семантические ранги и массовые симуляции.</p>

        <div className="model-summary">
          <span className={`model-light${props.model?.kind === "navec" ? " is-ready" : ""}`} />
          <div><small>Семантическая модель</small><strong>{props.model?.source ?? "Загрузка…"}</strong></div>
          <code>{props.model?.vocabularySize.toLocaleString("ru-RU") ?? "—"} слов</code>
        </div>

        <div className="lab-settings">
          <label><span>Характер ИИ-оперативника</span><select value={props.profile} onChange={(event) => props.onProfileChange(event.target.value as OperativeProfile)}><option value="cautious">Осторожный</option><option value="balanced">Сбалансированный</option><option value="daring">Рискованный</option></select></label>
          <label className="check-setting"><input type="checkbox" checked={props.showTrace} onChange={(event) => props.onShowTraceChange(event.target.checked)} /><span>Семантический след и ранги</span></label>
          <label className="check-setting"><input type="checkbox" checked={props.showKey} onChange={(event) => props.onShowKeyChange(event.target.checked)} /><span>Принудительно показать ключ</span></label>
        </div>

        {props.clue ? (
          <section className="lab-trace">
            <header><strong>Ближайшие к «{props.clue.word}»</strong><span>уверенность {Math.round(props.clue.confidence * 100)}% · {props.clue.candidateCount} кандидатов · зазор {props.clue.margin.toFixed(3)}</span></header>
            <ol>{props.clue.rankings.slice(0, 8).map((item) => <li key={item.index}><span>#{item.rank}</span><strong>{item.word}</strong><code>{item.similarity.toFixed(3)}</code></li>)}</ol>
            {props.lastPlan?.stopReason ? <p>Причина остановки: {props.lastPlan.stopReason}</p> : null}
          </section>
        ) : <p className="lab-empty">Семантическая трасса появится после первой подсказки.</p>}

        <SimulationPanel profile={props.profile} />
        <footer className="modal-actions"><button className="game-action game-action--quiet" type="button" onClick={props.onNewGame}>Сдать поле и начать заново</button></footer>
      </section>
    </div>
  );
}
