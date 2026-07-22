import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ApiStatus, type ResolveResult } from "./api.js";
import { Board } from "./components/Board.js";
import { DeveloperModal } from "./components/DeveloperModal.js";
import { History } from "./components/History.js";
import { PlayersModal } from "./components/PlayersModal.js";
import { TurnPanel, type GamePhase } from "./components/TurnPanel.js";
import { remainingForTeam } from "./domain/game.js";
import type { TeamSeats } from "./domain/multiplayer.js";
import type {
  ClueAnalysis,
  GameState,
  GuessPlan,
  OperativeProfile,
  Team,
  TurnRecord
} from "./domain/types.js";

const REVEAL_DELAY = 520;

const DEFAULT_SEATS: TeamSeats = {
  red: {
    spymaster: { controller: "ai", name: "ИИ-ведущий" },
    operative: { controller: "human", name: "Вы" }
  },
  blue: {
    spymaster: { controller: "ai", name: "ИИ-ведущий" },
    operative: { controller: "ai", name: "ИИ-оперативники" }
  }
};

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function teamName(team: Team) {
  return team === "red" ? "красных" : "синих";
}

function previewReveal(state: GameState, index: number): GameState {
  return {
    ...state,
    cards: state.cards.map((card, cardIndex) => cardIndex === index ? { ...card, revealed: true } : { ...card }),
    history: [...state.history]
  };
}

export function App() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [turnBase, setTurnBase] = useState<GameState | null>(null);
  const [phase, setPhase] = useState<GamePhase>("clue");
  const [seats, setSeats] = useState<TeamSeats>(DEFAULT_SEATS);
  const [clue, setClue] = useState<ClueAnalysis | null>(null);
  const [lastPlan, setLastPlan] = useState<GuessPlan | null>(null);
  const [lastRecord, setLastRecord] = useState<TurnRecord | null>(null);
  const [pickedIndices, setPickedIndices] = useState<number[]>([]);
  const [profile, setProfile] = useState<OperativeProfile>("balanced");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualClue, setManualClue] = useState("");
  const [manualNumber, setManualNumber] = useState(2);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);

  const resetFlow = useCallback((nextGame: GameState) => {
    setGame(nextGame);
    setTurnBase(null);
    setPhase("clue");
    setClue(null);
    setLastPlan(null);
    setLastRecord(null);
    setPickedIndices([]);
    setManualClue("");
  }, []);

  const startNewGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAutoPlay(false);
    try {
      resetFlow(await api.newGame(undefined, "red"));
      setPlayersOpen(false);
      setDeveloperOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать поле.");
    } finally {
      setLoading(false);
    }
  }, [resetFlow]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.status(), api.newGame(undefined, "red")])
      .then(([nextStatus, nextGame]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        resetFlow(nextGame);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Сервер игры недоступен.");
      });
    return () => { cancelled = true; };
  }, [resetFlow]);

  const requestAiClue = useCallback(async () => {
    if (!game || game.winner || phase !== "clue" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const generated = await api.clue(game);
      setTurnBase(game);
      setClue(generated);
      setPickedIndices([]);
      setPhase("guess");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ведущий не смог дать подсказку.");
      setAutoPlay(false);
    } finally {
      setLoading(false);
    }
  }, [game, loading, phase]);

  async function submitHumanClue() {
    if (!game || phase !== "clue" || !manualClue.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const analyzed = await api.analyzeClue(game, manualClue.trim(), manualNumber);
      setTurnBase(game);
      setClue(analyzed);
      setPickedIndices([]);
      setPhase("guess");
      setManualClue("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Эту подсказку нельзя использовать.");
    } finally {
      setLoading(false);
    }
  }

  const acceptResolvedTurn = useCallback(async (base: GameState, resolved: ResolveResult, animate: boolean) => {
    if (animate) {
      let preview = base;
      for (const guess of resolved.revealed) {
        preview = previewReveal(preview, guess.index);
        setGame(preview);
        await delay(REVEAL_DELAY);
      }
    }
    setGame(resolved.state);
    setLastRecord(resolved.record);
    setPhase("result");
  }, []);

  const startAiGuess = useCallback(async () => {
    if (!turnBase || !clue || phase !== "guess" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const plan = await api.guesses(turnBase, clue.word, clue.number, profile);
      setLastPlan(plan);
      const resolved = await api.resolveTurn(
        turnBase,
        clue.word,
        clue.number,
        plan.picks.map((pick) => pick.index),
        plan.stoppedEarly
      );
      await acceptResolvedTurn(turnBase, resolved, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Оперативник не смог завершить ход.");
      setAutoPlay(false);
    } finally {
      setLoading(false);
    }
  }, [acceptResolvedTurn, clue, loading, phase, profile, turnBase]);

  const finishHumanGuess = useCallback(async (indices = pickedIndices, stoppedEarly = true) => {
    if (!turnBase || !clue || phase !== "guess" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const resolved = await api.resolveTurn(turnBase, clue.word, clue.number, indices, stoppedEarly);
      await acceptResolvedTurn(turnBase, resolved, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось применить ответы.");
    } finally {
      setLoading(false);
    }
  }, [acceptResolvedTurn, clue, loading, phase, pickedIndices, turnBase]);

  function chooseCard(index: number) {
    if (!game || !turnBase || !clue || phase !== "guess" || loading || game.cards[index]?.revealed) return;
    const team = turnBase.turn;
    const nextPicks = [...pickedIndices, index];
    const nextGame = previewReveal(game, index);
    const card = nextGame.cards[index];
    setGame(nextGame);
    setPickedIndices(nextPicks);

    const completesTeam = (card.role === "red" || card.role === "blue") && remainingForTeam(nextGame, card.role) === 0;
    const mustStop = card.role === "assassin" || card.role !== team || completesTeam || nextPicks.length >= clue.number + 1;
    if (mustStop) void finishHumanGuess(nextPicks, false);
  }

  const continueToNextTurn = useCallback(() => {
    setPhase("clue");
    setTurnBase(null);
    setClue(null);
    setPickedIndices([]);
    setLastRecord(null);
  }, []);

  useEffect(() => {
    if (!autoPlay || !game || loading || game.winner) return;
    const visibleTeam = phase === "result" && lastRecord ? lastRecord.team : game.turn;
    let action: (() => void) | null = null;
    if (phase === "clue" && seats[visibleTeam].spymaster.controller === "ai") action = () => void requestAiClue();
    if (phase === "guess" && seats[visibleTeam].operative.controller === "ai") action = () => void startAiGuess();
    if (phase === "result") action = continueToNextTurn;
    if (!action) return;
    const timer = window.setTimeout(action, phase === "result" ? 1100 : 720);
    return () => window.clearTimeout(timer);
  }, [autoPlay, continueToNextTurn, game, lastRecord, loading, phase, requestAiClue, seats, startAiGuess]);

  const activeTeam = phase === "result" && lastRecord ? lastRecord.team : (game?.turn ?? "red");
  const activeOperativeIsHuman = game && seats[activeTeam].operative.controller === "human";
  const showKeyForSpymaster = Boolean(game && phase === "clue" && seats[game.turn].spymaster.controller === "human");
  const counts = game ? { red: remainingForTeam(game, "red"), blue: remainingForTeam(game, "blue") } : { red: 0, blue: 0 };
  const seatCounts = useMemo(() => {
    const all = Object.values(seats).flatMap((team) => [team.spymaster, team.operative]);
    return { humans: all.filter((seat) => seat.controller === "human").length, ai: all.filter((seat) => seat.controller === "ai").length };
  }, [seats]);

  return (
    <div className="app-shell play-app">
      <header className="play-header">
        <a className="brand" href="#game" aria-label="Связи, к игровому полю">
          <span className="brand__mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>Связи</strong><small>семантические кодовые имена</small></span>
        </a>
        <div className="scoreboard" aria-label="Оставшиеся агенты">
          <div className="score is-red"><span>красные</span><strong>{counts.red}</strong></div>
          <div className={`score-turn is-${activeTeam}`}><span>ход</span><strong>{game?.turnNumber ?? "—"}</strong></div>
          <div className="score is-blue"><strong>{counts.blue}</strong><span>синие</span></div>
        </div>
        <nav className="header-tools">
          <button type="button" onClick={() => setPlayersOpen(true)}><span className="players-icon">♟♟</span> Игроки <small>{seatCounts.humans} + {seatCounts.ai} ИИ</small></button>
          <button type="button" className="lab-button" onClick={() => setDeveloperOpen(true)} aria-label="Открыть лабораторию">
            <span aria-hidden="true">⌁</span><b>Лаборатория</b>
          </button>
        </nav>
      </header>

      <main id="game" className={`play-layout is-${activeTeam}`}>
        <section className="turn-baton">
          <div className="turn-baton__team"><span className={`team-beacon is-${activeTeam}`} /><strong>Ход {teamName(activeTeam)}</strong></div>
          <div className="turn-baton__message" key={`${activeTeam}-${phase}`}>
            <span>{phase === "clue" ? "Ведущий даёт подсказку" : phase === "guess" ? "Оперативники открывают карточки" : game?.winner ? `Победа ${teamName(game.winner)}` : "Команда завершила ход"}</span>
            <small>{phase === "clue" ? "Поле пока закрыто для ответов" : phase === "guess" && clue ? `${clue.word} — ${clue.number}` : "Посмотрите итог и передайте ход"}</small>
          </div>
          <div className="turn-baton__role">{phase === "clue" ? seats[activeTeam].spymaster.name : phase === "guess" ? seats[activeTeam].operative.name : "Переход хода"}</div>
        </section>

        <section className="board-area">
          <div className="board-title">
            <div><span>Игровое поле</span><h1>{phase === "guess" ? "Выберите связанные слова" : "25 кодовых имён"}</h1></div>
            <div className="board-legend"><span><i className="is-red" /> агент</span><span><i className="is-neutral" /> мирный</span><span><i className="is-blue" /> агент</span></div>
          </div>
          {game ? (
            <Board
              cards={game.cards}
              clue={clue}
              showKey={showKey || showKeyForSpymaster}
              showTrace={showTrace}
              interactive={Boolean(phase === "guess" && activeOperativeIsHuman && !loading)}
              currentTeam={activeTeam}
              onCardClick={chooseCard}
            />
          ) : <div className="board-loading"><span />Раскладываю карточки…</div>}
          {showKeyForSpymaster && !showKey ? <div className="key-warning">Ключ виден ведущему. После передачи подсказки он будет скрыт.</div> : null}
        </section>

        <div className="game-sidebar">
          {game ? (
            <TurnPanel
              phase={phase}
              team={activeTeam}
              nextTeam={game.turn}
              seats={seats}
              clue={clue}
              result={lastRecord}
              winner={game.winner}
              loading={loading}
              pickedCount={pickedIndices.length}
              manualClue={manualClue}
              manualNumber={manualNumber}
              onManualClueChange={setManualClue}
              onManualNumberChange={setManualNumber}
              onSubmitClue={() => void submitHumanClue()}
              onRequestClue={() => void requestAiClue()}
              onStartAiGuess={() => void startAiGuess()}
              onFinishHumanGuess={() => void finishHumanGuess()}
              onContinue={continueToNextTurn}
              onNewGame={() => void startNewGame()}
            />
          ) : null}
          {game ? <History history={game.history} /> : null}
        </div>
      </main>

      <footer className="play-footer"><span>Локальная партия · без LLM</span><span>Правила и роли разделены — готово к синхронизации комнаты</span></footer>

      <PlayersModal open={playersOpen} seats={seats} onSeatsChange={setSeats} onClose={() => setPlayersOpen(false)} onNewGame={() => void startNewGame()} />
      <DeveloperModal
        open={developerOpen}
        model={status?.model ?? null}
        clue={clue}
        lastPlan={lastPlan}
        profile={profile}
        onProfileChange={setProfile}
        showTrace={showTrace}
        onShowTraceChange={setShowTrace}
        showKey={showKey}
        onShowKeyChange={setShowKey}
        autoPlay={autoPlay}
        onAutoPlayChange={setAutoPlay}
        onNewGame={() => void startNewGame()}
        onClose={() => setDeveloperOpen(false)}
      />

      {error ? <div className="error-toast" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Закрыть">×</button></div> : null}
    </div>
  );
}
