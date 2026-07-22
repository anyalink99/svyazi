import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { GamePhase } from "./TurnPanel.js";

interface PhaseTimerProps {
  enabled: boolean;
  phase: GamePhase;
  startedAt: number;
  durationSeconds: number;
}

export function PhaseTimer({ enabled, phase, startedAt, durationSeconds }: PhaseTimerProps) {
  const [now, setNow] = useState(Date.now());
  const active = enabled && phase !== "result";

  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  const remainingMs = Math.max(0, startedAt + durationSeconds * 1000 - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progress = Math.max(0, Math.min(1, remainingMs / (durationSeconds * 1000)));
  const label = useMemo(() => {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [remainingSeconds]);

  if (!active) return null;
  return (
    <div
      className={`phase-timer${remainingSeconds <= 10 ? " is-urgent" : ""}${remainingSeconds === 0 ? " is-expired" : ""}`}
      style={{ "--timer-progress": progress } as CSSProperties}
      role="timer"
      aria-label={remainingSeconds ? `Осталось ${label}` : "Время вышло"}
    >
      <i aria-hidden="true"><span /></i>
      <div><small>{remainingSeconds ? "осталось" : "время"}</small><strong>{label}</strong></div>
    </div>
  );
}
