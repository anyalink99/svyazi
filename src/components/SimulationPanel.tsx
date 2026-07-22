import { useState } from "react";
import { api } from "../api.js";
import type { OperativeProfile, SimulationSummary } from "../domain/types.js";

interface SimulationPanelProps {
  profile: OperativeProfile;
}

export function SimulationPanel({ profile }: SimulationPanelProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<SimulationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSimulation() {
    setRunning(true);
    setError(null);
    try {
      setSummary(await api.simulate(100, profile, profile));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Симуляция не запустилась.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={`simulation-panel${open ? " is-open" : ""}`}>
      <button className="simulation-panel__toggle" type="button" onClick={() => setOpen((value) => !value)}>
        <span>
          <span className="eyebrow">Полигон</span>
          <strong>Проверить агентов</strong>
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="simulation-panel__body">
          <p>Сыграть 100 полностью автоматических партий и измерить поведение текущего профиля.</p>
          <button className="button button--secondary button--wide" type="button" disabled={running} onClick={runSimulation}>
            {running ? "Идёт прогон…" : "Запустить 100 партий"}
          </button>
          {error ? <p className="inline-error">{error}</p> : null}
          {summary ? (
            <dl className="simulation-stats">
              <div><dt>Ходов на партию</dt><dd>{summary.averageTurns.toFixed(1)}</dd></div>
              <div><dt>Верных за ход</dt><dd>{summary.averageCorrectPerTurn.toFixed(2)}</dd></div>
              <div><dt>Финиши убийцей</dt><dd>{((summary.assassinFinishes / summary.games) * 100).toFixed(1)}%</dd></div>
              <div><dt>Время</dt><dd>{(summary.durationMs / 1000).toFixed(1)} с</dd></div>
            </dl>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
