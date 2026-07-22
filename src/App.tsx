import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ApiStatus, type ResolveResult } from "./api.js";
import { Board } from "./components/Board.js";
import { DeveloperModal } from "./components/DeveloperModal.js";
import { History } from "./components/History.js";
import { PlayersModal } from "./components/PlayersModal.js";
import { TurnPanel, type GamePhase, type VoteStatus } from "./components/TurnPanel.js";
import { remainingForTeam } from "./domain/game.js";
import type { AiTuning, TeamSeats } from "./domain/multiplayer.js";
import { allSeats, cloneSeats, DEFAULT_AI_TUNING, DEFAULT_SEATS, operativeNames, seatTeamAndRole } from "./domain/setup.js";
import type { ClueAnalysis, GameState, GuessPlan, OperativeProfile, Team, TurnRecord } from "./domain/types.js";
import { castCardVote } from "./domain/voting.js";

const REVEAL_DELAY = 520;
const DEFAULT_LOCAL_SEAT_ID = "red-operative-you";

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
    history: state.history.map((record) => ({ ...record }))
  };
}

function commitRemainingDraft(state: GameState, team: Team, draft: Record<string, number>): GameState {
  return {
    ...state,
    history: state.history.map((record) => {
      const remaining = draft[`${record.team}:${record.turn}`];
      return record.team === team && remaining !== undefined
        ? { ...record, remaining: Math.max(0, Math.min(record.number, remaining)) }
        : record;
    })
  };
}

export function App() {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [turnBase, setTurnBase] = useState<GameState | null>(null);
  const [phase, setPhase] = useState<GamePhase>("clue");
  const [seats, setSeats] = useState<TeamSeats>(() => cloneSeats(DEFAULT_SEATS));
  const [tuning, setTuning] = useState<AiTuning>(() => structuredClone(DEFAULT_AI_TUNING));
  const [localSeatId, setLocalSeatId] = useState<string | null>(DEFAULT_LOCAL_SEAT_ID);
  const [clue, setClue] = useState<ClueAnalysis | null>(null);
  const [lastPlan, setLastPlan] = useState<GuessPlan | null>(null);
  const [lastRecord, setLastRecord] = useState<TurnRecord | null>(null);
  const [pickedIndices, setPickedIndices] = useState<number[]>([]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [voteCursor, setVoteCursor] = useState(0);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualClue, setManualClue] = useState("");
  const [manualNumber, setManualNumber] = useState(2);
  const [remainingDraft, setRemainingDraft] = useState<Record<string, number>>({});
  const [playersOpen, setPlayersOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);

  const activeTeam = phase === "result" && lastRecord ? lastRecord.team : (game?.turn ?? "red");
  const localSeat = useMemo(() => seatTeamAndRole(seats, localSeatId), [localSeatId, seats]);
  const persistentSpymasterView = localSeat?.role === "spymaster";
  const localOperativeCanAct = Boolean(
    localSeat?.role === "operative" &&
    localSeat.team === activeTeam &&
    localSeat.seat.controller === "human"
  );
  const activeOperatives = seats[activeTeam].operatives;
  const humanOperatives = activeOperatives.filter((seat) => seat.controller === "human");
  const allActiveOperativesAi = activeOperatives.every((seat) => seat.controller === "ai");
  const allowUnknownClue = activeOperatives.every((seat) => seat.controller === "human");
  const currentVoter = humanOperatives[voteCursor] ?? humanOperatives[0] ?? null;
  const activeVoterIds = activeOperatives.map((seat) => seat.id);
  const voteStatus: VoteStatus | null = allActiveOperativesAi ? null : {
    currentVoterName: currentVoter?.name ?? null,
    cast: activeVoterIds.filter((id) => Number.isInteger(votes[id])).length,
    total: activeVoterIds.length,
    message: voteMessage
  };

  const resetVoting = useCallback(() => {
    setVotes({});
    setVoteCursor(0);
    setVoteMessage(null);
  }, []);

  const resetFlow = useCallback((nextGame: GameState) => {
    setGame(nextGame);
    setTurnBase(null);
    setPhase("clue");
    setClue(null);
    setLastPlan(null);
    setLastRecord(null);
    setPickedIndices([]);
    setVotes({});
    setVoteCursor(0);
    setVoteMessage(null);
    setManualClue("");
    setRemainingDraft({});
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

  useEffect(() => {
    resetVoting();
  }, [game?.turnNumber, phase, resetVoting, seats]);

  const requestAiClue = useCallback(async () => {
    if (!game || game.winner || phase !== "clue" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const clueBase = commitRemainingDraft(game, game.turn, remainingDraft);
      const generated = await api.clue(clueBase, tuning[game.turn].ambition);
      setGame(clueBase);
      setTurnBase(clueBase);
      setClue(generated);
      setPickedIndices([]);
      setRemainingDraft({});
      resetVoting();
      setPhase("guess");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ведущий не смог дать подсказку.");
      setAutoPlay(false);
    } finally {
      setLoading(false);
    }
  }, [game, loading, phase, remainingDraft, resetVoting, tuning]);

  async function submitHumanClue() {
    if (!game || phase !== "clue" || !manualClue.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const teamAllowsUnknown = seats[game.turn].operatives.every((seat) => seat.controller === "human");
      const clueBase = commitRemainingDraft(game, game.turn, remainingDraft);
      const analyzed = await api.analyzeClue(clueBase, manualClue.trim(), manualNumber, teamAllowsUnknown);
      setGame(clueBase);
      setTurnBase(clueBase);
      setClue(analyzed);
      setPickedIndices([]);
      setRemainingDraft({});
      resetVoting();
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
    resetVoting();
    setPhase("result");
  }, [resetVoting]);

  const startAiGuess = useCallback(async () => {
    if (!turnBase || !clue || phase !== "guess" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const risk = tuning[turnBase.turn].risk;
      const plan = await api.guesses(turnBase, clue.word, clue.number, risk);
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
  }, [acceptResolvedTurn, clue, loading, phase, tuning, turnBase]);

  const finishHumanGuess = useCallback(async (indices = pickedIndices, stoppedEarly = true) => {
    if (!turnBase || !clue || phase !== "guess" || loading) return;
    setLoading(true);
    setError(null);
    try {
      const teamAllowsUnknown = seats[turnBase.turn].operatives.every((seat) => seat.controller === "human");
      const resolved = await api.resolveTurn(turnBase, clue.word, clue.number, indices, stoppedEarly, teamAllowsUnknown);
      await acceptResolvedTurn(turnBase, resolved, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось применить ответы.");
    } finally {
      setLoading(false);
    }
  }, [acceptResolvedTurn, clue, loading, phase, pickedIndices, seats, turnBase]);

  function revealHumanChoice(index: number) {
    if (!game || !turnBase || !clue || game.cards[index]?.revealed) return;
    const team = turnBase.turn;
    const nextPicks = [...pickedIndices, index];
    const nextGame = previewReveal(game, index);
    const card = nextGame.cards[index];
    setGame(nextGame);
    setPickedIndices(nextPicks);
    resetVoting();

    const completesTeam = (card.role === "red" || card.role === "blue") && remainingForTeam(nextGame, card.role) === 0;
    const mustStop = card.role === "assassin" || card.role !== team || completesTeam;
    if (mustStop) void finishHumanGuess(nextPicks, false);
  }

  async function chooseCard(index: number) {
    if (!game || !turnBase || !clue || phase !== "guess" || loading || game.cards[index]?.revealed) return;
    const team = turnBase.turn;
    const operatives = seats[team].operatives;
    const humans = operatives.filter((seat) => seat.controller === "human");
    const aiOperatives = operatives.filter((seat) => seat.controller === "ai");

    if (operatives.length === 1 && humans.length === 1) {
      revealHumanChoice(index);
      return;
    }

    const voter = humans[voteCursor] ?? humans[0];
    if (!voter) return;
    setVoteMessage(null);
    let round = castCardVote(votes, operatives.map((seat) => seat.id), voter.id, index);
    setVotes(round.votes);

    const humansComplete = humans.every((seat) => Number.isInteger(round.votes[seat.id]));
    if (!humansComplete) {
      setVoteCursor((cursor) => Math.min(cursor + 1, humans.length - 1));
      return;
    }

    let handedOffToResolution = false;
    try {
      if (aiOperatives.length) {
        setLoading(true);
        const plan = await api.guesses(game, clue.word, clue.number, tuning[team].risk);
        setLastPlan(plan);
        const aiChoice = plan.picks[0]?.index;
        if (aiChoice === undefined) {
          setVotes({});
          setVoteCursor(0);
          setVoteMessage("ИИ предлагает остановиться. Карточка не открыта.");
          return;
        }
        for (const operative of aiOperatives) {
          round = castCardVote(round.votes, operatives.map((seat) => seat.id), operative.id, aiChoice);
        }
      }

      if (round.complete && round.consensusIndex !== null) {
        handedOffToResolution = true;
        setLoading(false);
        revealHumanChoice(round.consensusIndex);
      } else {
        setVotes({});
        setVoteCursor(0);
        setVoteMessage("Голоса не совпали. Обсудите выбор и попробуйте ещё раз.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось собрать голоса команды.");
    } finally {
      if (!handedOffToResolution) setLoading(false);
    }
  }

  const continueToNextTurn = useCallback(() => {
    setPhase("clue");
    setTurnBase(null);
    setClue(null);
    setPickedIndices([]);
    setLastRecord(null);
    setRemainingDraft({});
    resetVoting();
  }, [resetVoting]);

  useEffect(() => {
    if (!autoPlay || !game || loading || game.winner) return;
    const visibleTeam = phase === "result" && lastRecord ? lastRecord.team : game.turn;
    let action: (() => void) | null = null;
    if (phase === "clue" && seats[visibleTeam].spymaster.controller === "ai") action = () => void requestAiClue();
    if (phase === "guess" && seats[visibleTeam].operatives.every((seat) => seat.controller === "ai")) action = () => void startAiGuess();
    if (phase === "result") action = continueToNextTurn;
    if (!action) return;
    const timer = window.setTimeout(action, phase === "result" ? 1100 : 720);
    return () => window.clearTimeout(timer);
  }, [autoPlay, continueToNextTurn, game, lastRecord, loading, phase, requestAiClue, seats, startAiGuess]);

  const counts = game ? { red: remainingForTeam(game, "red"), blue: remainingForTeam(game, "blue") } : { red: 0, blue: 0 };
  const seatCounts = useMemo(() => {
    const players = allSeats(seats);
    return { humans: players.filter((seat) => seat.controller === "human").length, ai: players.filter((seat) => seat.controller === "ai").length };
  }, [seats]);

  function changeActiveTuning(patch: Partial<AiTuning[Team]>) {
    setTuning((current) => ({ ...current, [activeTeam]: { ...current[activeTeam], ...patch } }));
  }

  function changeRemainingDraft(record: TurnRecord, remaining: number) {
    setRemainingDraft((current) => ({
      ...current,
      [`${record.team}:${record.turn}`]: Math.max(0, Math.min(record.number, remaining))
    }));
  }

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

      <main id="game" className={`play-layout is-${activeTeam}${persistentSpymasterView ? " is-spymaster-view" : ""}`}>
        <section className="turn-baton">
          <div className="turn-baton__team"><span className={`team-beacon is-${activeTeam}`} /><strong>Ход {teamName(activeTeam)}</strong></div>
          <div className="turn-baton__message" key={`${activeTeam}-${phase}`}>
            <span>{phase === "clue" ? "Ведущий даёт подсказку" : phase === "guess" ? "Команда согласует карточки" : game?.winner ? `Победа ${teamName(game.winner)}` : "Команда завершила ход"}</span>
          </div>
          <div className="turn-baton__role">{phase === "clue" ? seats[activeTeam].spymaster.name : phase === "guess" ? operativeNames(seats, activeTeam) : "Переход хода"}</div>
        </section>

        <section className="board-area">
          {game ? (
            <Board
              cards={game.cards}
              clue={clue}
              showKey={showKey || persistentSpymasterView}
              showTrace={showTrace}
              interactive={Boolean(phase === "guess" && localOperativeCanAct && !loading && !persistentSpymasterView)}
              currentTeam={activeTeam}
              onCardClick={(index) => void chooseCard(index)}
            />
          ) : <div className="board-loading"><span />Раскладываю карточки…</div>}
        </section>

        <div className="game-sidebar">
          {game ? (
            <TurnPanel
              phase={phase}
              team={activeTeam}
              nextTeam={game.turn}
              seats={seats}
              tuning={tuning[activeTeam]}
              clue={clue}
              result={lastRecord}
              winner={game.winner}
              loading={loading}
              pickedCount={pickedIndices.length}
              manualClue={manualClue}
              manualNumber={manualNumber}
              allowUnknownClue={allowUnknownClue}
              previousClues={game.history}
              remainingDraft={remainingDraft}
              voteStatus={voteStatus}
              onManualClueChange={setManualClue}
              onManualNumberChange={setManualNumber}
              onTuningChange={changeActiveTuning}
              onRemainingDraftChange={changeRemainingDraft}
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

      <PlayersModal
        open={playersOpen}
        seats={seats}
        tuning={tuning}
        localSeatId={localSeatId}
        onSeatsChange={setSeats}
        onTuningChange={setTuning}
        onLocalSeatChange={setLocalSeatId}
        onClose={() => setPlayersOpen(false)}
        onNewGame={() => void startNewGame()}
      />
      <DeveloperModal
        open={developerOpen}
        model={status?.model ?? null}
        clue={clue}
        lastPlan={lastPlan}
        profile={tuning[activeTeam].risk}
        onProfileChange={(risk: OperativeProfile) => changeActiveTuning({ risk })}
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
