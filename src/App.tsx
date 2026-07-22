import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ApiStatus, type ResolveResult } from "./api.js";
import { Board, type BoardVoteMarker } from "./components/Board.js";
import { DeveloperModal } from "./components/DeveloperModal.js";
import { History } from "./components/History.js";
import { PlayersModal } from "./components/PlayersModal.js";
import { PhaseTimer } from "./components/PhaseTimer.js";
import { TurnPanel, type GamePhase, type VoteStatus } from "./components/TurnPanel.js";
import { remainingForTeam } from "./domain/game.js";
import { refreshTrackedClueRemainders } from "./domain/clues.js";
import {
  claimLobbySeat,
  EMPTY_LOBBY,
  lobbyIsReady,
  participantSeat,
  reconcileLobby,
  removeLobbyParticipant,
  seatsWithLobbyNames,
  upsertLobbyParticipant,
  type LobbyState
} from "./domain/lobby.js";
import type { AiTuning, TeamSeats } from "./domain/multiplayer.js";
import { allSeats, cloneSeats, DEFAULT_AI_TUNING, DEFAULT_SEATS, operativeNames, seatTeamAndRole } from "./domain/setup.js";
import { loadSession, saveSession } from "./domain/session.js";
import type { ClueAnalysis, GameState, GuessPlan, OperativeProfile, Team, TurnRecord } from "./domain/types.js";
import { castCardVote } from "./domain/voting.js";
import { useP2PRoom, type MultiplayerCommand, type SharedSession } from "./multiplayer/p2p.js";

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
  const [restoredSession] = useState(() => loadSession());
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [game, setGame] = useState<GameState | null>(restoredSession?.game ?? null);
  const [turnBase, setTurnBase] = useState<GameState | null>(restoredSession?.turnBase ?? null);
  const [phase, setPhase] = useState<GamePhase>(restoredSession?.phase ?? "clue");
  const [seats, setSeats] = useState<TeamSeats>(() => restoredSession?.seats ?? cloneSeats(DEFAULT_SEATS));
  const [tuning, setTuning] = useState<AiTuning>(() => restoredSession?.tuning ?? structuredClone(DEFAULT_AI_TUNING));
  const [localSeatId, setLocalSeatId] = useState<string | null>(restoredSession?.localSeatId ?? DEFAULT_LOCAL_SEAT_ID);
  const [clue, setClue] = useState<ClueAnalysis | null>(restoredSession?.clue ?? null);
  const [lastPlan, setLastPlan] = useState<GuessPlan | null>(restoredSession?.lastPlan ?? null);
  const [lastRecord, setLastRecord] = useState<TurnRecord | null>(restoredSession?.lastRecord ?? null);
  const [pickedIndices, setPickedIndices] = useState<number[]>(restoredSession?.pickedIndices ?? []);
  const [votes, setVotes] = useState<Record<string, number>>(restoredSession?.votes ?? {});
  const [finishVotes, setFinishVotes] = useState<Record<string, boolean>>(restoredSession?.finishVotes ?? {});
  const [voteCursor, setVoteCursor] = useState(restoredSession?.voteCursor ?? 0);
  const [voteMessage, setVoteMessage] = useState<string | null>(restoredSession?.voteMessage ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualClue, setManualClue] = useState(restoredSession?.manualClue ?? "");
  const [manualNumber, setManualNumber] = useState(restoredSession?.manualNumber ?? 2);
  const [remainingDraft, setRemainingDraft] = useState<Record<string, number>>(restoredSession?.remainingDraft ?? {});
  const [playersOpen, setPlayersOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [showTrace, setShowTrace] = useState(restoredSession?.showTrace ?? false);
  const [showKey, setShowKey] = useState(restoredSession?.showKey ?? false);
  const [autoPlay, setAutoPlay] = useState(restoredSession?.autoPlay ?? false);
  const [timerEnabled, setTimerEnabled] = useState(restoredSession?.timerEnabled ?? true);
  const [phaseStartedAt, setPhaseStartedAt] = useState(restoredSession?.phaseStartedAt ?? Date.now());
  const [lobby, setLobby] = useState<LobbyState>(EMPTY_LOBBY);
  const lobbyRef = useRef(lobby);
  const seatsRef = useRef(seats);
  const gameRef = useRef(game);
  const phaseRef = useRef(phase);
  const votesRef = useRef(votes);
  const finishVotesRef = useRef(finishVotes);
  const pickedIndicesRef = useRef(pickedIndices);
  const loadingRef = useRef(loading);
  const preferredNetworkSeatRef = useRef<string | null>(restoredSession?.localSeatId ?? DEFAULT_LOCAL_SEAT_ID);
  const reconnectClaimAttemptedRef = useRef(false);
  lobbyRef.current = lobby;
  seatsRef.current = seats;
  gameRef.current = game;
  phaseRef.current = phase;
  votesRef.current = votes;
  finishVotesRef.current = finishVotes;
  pickedIndicesRef.current = pickedIndices;
  loadingRef.current = loading;
  const network = useP2PRoom({
    getSnapshot: buildSharedSession,
    onSnapshot: applySharedSession,
    onCommand: handleNetworkCommand,
    onPeerIdentity: handlePeerIdentity,
    onPeerLeave: handlePeerLeave,
    onNotice: setError
  });

  const displaySeats = useMemo(() => network.role === "offline" ? seats : seatsWithLobbyNames(seats, lobby), [lobby, network.role, seats]);
  const activeTeam = phase === "result" && lastRecord ? lastRecord.team : (game?.turn ?? "red");
  const localSeat = useMemo(() => seatTeamAndRole(displaySeats, localSeatId), [displaySeats, localSeatId]);
  const persistentSpymasterView = localSeat?.role === "spymaster";
  const localOperativeCanAct = Boolean(
    localSeat?.role === "operative" &&
    localSeat.team === activeTeam &&
    localSeat.seat.controller === "human"
  );
  const activeOperatives = displaySeats[activeTeam].operatives;
  const humanOperatives = activeOperatives.filter((seat) => seat.controller === "human");
  const allActiveOperativesAi = activeOperatives.every((seat) => seat.controller === "ai");
  const allowUnknownClue = activeOperatives.every((seat) => seat.controller === "human");
  const activeVoterIds = activeOperatives.map((seat) => seat.id);
  const voteStatus: VoteStatus | null = allActiveOperativesAi ? null : {
    cast: activeVoterIds.filter((id) => Number.isInteger(votes[id])).length,
    total: activeVoterIds.length,
    message: voteMessage,
    finishCast: activeVoterIds.filter((id) => finishVotes[id]).length,
    localFinishVoted: Boolean(localSeatId && finishVotes[localSeatId])
  };
  const voteMarkers = useMemo<BoardVoteMarker[]>(() => activeOperatives.flatMap((seat) => {
    const index = votes[seat.id];
    return Number.isInteger(index) ? [{ seatId: seat.id, name: seat.name, team: activeTeam, index }] : [];
  }), [activeOperatives, activeTeam, votes]);
  const phaseDurationSeconds = phase === "clue" && game?.turnNumber === 1 ? 120 : 60;
  const canControlSystem = network.role !== "guest";
  const canManageLobby = network.role !== "guest";
  const lobbyReady = network.role === "offline" || lobbyIsReady(lobby, seats);
  const canAdvanceSystem = canControlSystem && lobbyReady;
  const canSubmitHumanClue = Boolean(
    lobbyReady && network.hostAvailable && localSeat?.role === "spymaster" && localSeat.team === activeTeam &&
    localSeat.seat.controller === "human" && phase === "clue"
  );
  const canFinishHumanGuess = Boolean(
    lobbyReady && network.hostAvailable && localSeat?.role === "operative" && localSeat.team === activeTeam &&
    localSeat.seat.controller === "human" && phase === "guess"
  );

  const resetVoting = useCallback(() => {
    votesRef.current = {};
    setVotes({});
    finishVotesRef.current = {};
    setFinishVotes({});
    setVoteCursor(0);
    setVoteMessage(null);
  }, []);

  function setAuthoritativeLobby(nextLobby: LobbyState) {
    lobbyRef.current = nextLobby;
    setLobby(nextLobby);
  }

  function updateLoading(nextLoading: boolean) {
    loadingRef.current = nextLoading;
    setLoading(nextLoading);
  }

  function buildSharedSession(): SharedSession | null {
    if (!game) return null;
    return {
      game,
      turnBase,
      phase,
      seats,
      tuning,
      clue,
      lastPlan,
      lastRecord,
      pickedIndices,
      votes,
      finishVotes,
      voteCursor,
      voteMessage,
      loading,
      lobby,
      autoPlay,
      timerEnabled,
      phaseStartedAt
    };
  }

  function applySharedSession(snapshot: SharedSession) {
    setGame(snapshot.game);
    setTurnBase(snapshot.turnBase);
    setPhase(snapshot.phase);
    setSeats(snapshot.seats);
    setTuning(snapshot.tuning);
    setClue(snapshot.clue);
    setLastPlan(snapshot.lastPlan);
    setLastRecord(snapshot.lastRecord);
    setPickedIndices(snapshot.pickedIndices);
    pickedIndicesRef.current = snapshot.pickedIndices;
    setVotes(snapshot.votes);
    votesRef.current = snapshot.votes;
    setFinishVotes(snapshot.finishVotes ?? {});
    finishVotesRef.current = snapshot.finishVotes ?? {};
    setVoteCursor(snapshot.voteCursor);
    setVoteMessage(snapshot.voteMessage);
    updateLoading(snapshot.loading);
    setAutoPlay(snapshot.autoPlay ?? false);
    setTimerEnabled(snapshot.timerEnabled ?? true);
    setPhaseStartedAt(snapshot.phaseStartedAt ?? Date.now());
    const nextLobby = snapshot.lobby ?? EMPTY_LOBBY;
    setAuthoritativeLobby(nextLobby);
    const self = nextLobby.participants.find((participant) => participant.id === network.selfId);
    if (
      network.role === "guest" && self && !self.seatId && preferredNetworkSeatRef.current &&
      !reconnectClaimAttemptedRef.current &&
      allSeats(snapshot.seats).some((seat) => seat.id === preferredNetworkSeatRef.current && seat.controller === "human")
    ) {
      reconnectClaimAttemptedRef.current = true;
      void network.sendCommand({ type: "claim-seat", seatId: preferredNetworkSeatRef.current, resume: true });
    }
    setError(null);
  }

  function handlePeerIdentity(peer: { id: string; name: string }) {
    const current = lobbyRef.current;
    const existing = current.participants.find((participant) => participant.id === peer.id);
    setAuthoritativeLobby(upsertLobbyParticipant(current, {
      id: peer.id,
      name: peer.name,
      isHost: false,
      seatId: existing?.seatId ?? null
    }));
  }

  function handlePeerLeave(peerId: string) {
    setAuthoritativeLobby(removeLobbyParticipant(lobbyRef.current, peerId));
    resetVoting();
  }

  function rejectCommand(peerId: string, message: string) {
    void network.sendNotice(peerId, message);
  }

  function handleNetworkCommand(command: MultiplayerCommand, peerId: string) {
    if (command.type === "claim-seat") {
      const result = claimLobbySeat(lobbyRef.current, seatsRef.current, peerId, command.seatId);
      if (!result.accepted) {
        rejectCommand(peerId, result.reason ?? "Не удалось занять место.");
        return;
      }
      setAuthoritativeLobby(result.lobby);
      if (!command.resume) resetVoting();
      return;
    }

    const actor = participantSeat(lobbyRef.current, seatsRef.current, peerId);
    const currentGame = gameRef.current;
    const currentPhase = phaseRef.current;
    if (!actor || actor.seat.controller !== "human" || !currentGame) {
      rejectCommand(peerId, "Сначала займите подходящее место в комнате.");
      return;
    }

    if (command.type === "submit-clue") {
      if (currentPhase !== "clue" || actor.role !== "spymaster" || actor.team !== currentGame.turn) {
        rejectCommand(peerId, "Сейчас подсказку даёт другой ведущий.");
        return;
      }
      void submitHumanClue(command);
      return;
    }

    if (currentPhase !== "guess" || actor.role !== "operative" || actor.team !== currentGame.turn) {
      rejectCommand(peerId, "Сейчас отвечает другая команда.");
      return;
    }
    if (command.type === "choose-card") {
      if (command.seatId !== actor.seat.id) {
        rejectCommand(peerId, "Нельзя голосовать от имени другого игрока.");
        return;
      }
      void chooseCard(command.index, actor.seat.id);
      return;
    }
    if (command.type === "finish-guess") {
      if (command.seatId !== actor.seat.id) {
        rejectCommand(peerId, "Нельзя завершать ход от имени другого игрока.");
        return;
      }
      void voteToFinish(actor.seat.id);
    }
  }

  function dispatchHumanAction(command: MultiplayerCommand, action: () => void) {
    if (network.role === "guest") {
      void network.sendCommand(command);
      return;
    }
    action();
  }

  const resetFlow = useCallback((nextGame: GameState) => {
    setGame(nextGame);
    setTurnBase(null);
    setPhase("clue");
    setPhaseStartedAt(Date.now());
    setClue(null);
    setLastPlan(null);
    setLastRecord(null);
    pickedIndicesRef.current = [];
    setPickedIndices([]);
    votesRef.current = {};
    setVotes({});
    finishVotesRef.current = {};
    setFinishVotes({});
    setVoteCursor(0);
    setVoteMessage(null);
    setManualClue("");
    setRemainingDraft({});
  }, []);

  const startNewGame = useCallback(async () => {
    if (loadingRef.current) return;
    updateLoading(true);
    setError(null);
    setAutoPlay(false);
    try {
      resetFlow(await api.newGame(undefined, "red"));
      setPlayersOpen(false);
      setDeveloperOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать поле.");
    } finally {
      updateLoading(false);
    }
  }, [resetFlow]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.status(), restoredSession ? Promise.resolve(null) : api.newGame(undefined, "red")])
      .then(([nextStatus, nextGame]) => {
        if (cancelled) return;
        setStatus(nextStatus);
        if (nextGame) resetFlow(nextGame);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Сервер игры недоступен.");
      });
    return () => { cancelled = true; };
  }, [resetFlow, restoredSession]);

  useEffect(() => {
    if (!game) return;
    saveSession({
      game,
      turnBase,
      phase,
      seats,
      tuning,
      localSeatId,
      clue,
      lastPlan,
      lastRecord,
      pickedIndices,
      votes,
      finishVotes,
      voteCursor,
      voteMessage,
      manualClue,
      manualNumber,
      remainingDraft,
      showTrace,
      showKey,
      autoPlay,
      timerEnabled,
      phaseStartedAt
    });
  }, [
    autoPlay, clue, finishVotes, game, lastPlan, lastRecord, localSeatId, manualClue, manualNumber,
    phase, pickedIndices, remainingDraft, seats, showKey, showTrace, tuning, turnBase,
    timerEnabled, phaseStartedAt, voteCursor, voteMessage, votes
  ]);

  useEffect(() => {
    if (!localSeatId) return;
    if (network.role !== "offline") return;
    const stillHuman = allSeats(seats).some((seat) => seat.id === localSeatId && seat.controller === "human");
    if (!stillHuman) setLocalSeatId(null);
  }, [localSeatId, network.role, seats]);

  useEffect(() => {
    if (network.role === "offline") {
      if (lobbyRef.current.participants.length) setAuthoritativeLobby(EMPTY_LOBBY);
      return;
    }
    if (network.role !== "host") return;
    const current = lobbyRef.current;
    const existing = current.participants.find((participant) => participant.id === network.selfId);
    let next = upsertLobbyParticipant(current, {
      id: network.selfId,
      name: network.localName,
      isHost: true,
      seatId: existing?.seatId ?? null
    });
    if (!existing && localSeatId) {
      const claim = claimLobbySeat(next, seatsRef.current, network.selfId, localSeatId);
      if (claim.accepted) next = claim.lobby;
    }
    setAuthoritativeLobby(next);
  }, [network.localName, network.role, network.selfId]);

  useEffect(() => {
    if (network.role === "offline") return;
    const authoritativeSeatId = lobby.participants.find((participant) => participant.id === network.selfId)?.seatId ?? null;
    setLocalSeatId(authoritativeSeatId);
  }, [lobby, network.role, network.selfId]);

  useEffect(() => {
    if (network.role === "guest" && !network.hostAvailable) reconnectClaimAttemptedRef.current = false;
  }, [network.hostAvailable, network.role]);

  useEffect(() => {
    if (network.role !== "host") return;
    const snapshot = buildSharedSession();
    if (snapshot) void network.broadcastSnapshot(snapshot);
  }, [
    autoPlay, clue, finishVotes, game, lastPlan, lastRecord, loading, lobby, network.broadcastSnapshot,
    network.role, phase, pickedIndices, seats, tuning, turnBase,
    timerEnabled, phaseStartedAt, voteCursor, voteMessage, votes
  ]);

  useEffect(() => {
    if (!game || phase !== "clue" || network.role === "guest") return;
    if (seats[game.turn].spymaster.controller !== "ai") return;
    setGame((current) => current ? refreshTrackedClueRemainders(current, current.turn) : current);
  }, [game?.turnNumber, network.role, phase, seats]);

  const requestAiClue = useCallback(async () => {
    if (!game || game.winner || phase !== "clue" || loadingRef.current) return;
    updateLoading(true);
    setError(null);
    try {
      const clueBase = refreshTrackedClueRemainders(game, game.turn);
      const generated = await api.clue(clueBase, tuning[game.turn].ambition);
      setGame(clueBase);
      setTurnBase(clueBase);
      setClue(generated);
      pickedIndicesRef.current = [];
      setPickedIndices([]);
      setRemainingDraft({});
      resetVoting();
      setPhaseStartedAt(Date.now());
      setPhase("guess");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ведущий не смог дать подсказку.");
      setAutoPlay(false);
    } finally {
      updateLoading(false);
    }
  }, [game, loading, phase, remainingDraft, resetVoting, tuning]);

  async function submitHumanClue(input?: { clue: string; number: number; remainingDraft: Record<string, number> }) {
    const clueWord = input?.clue ?? manualClue;
    const clueNumber = input?.number ?? manualNumber;
    const clueDraft = input?.remainingDraft ?? remainingDraft;
    if (!game || phase !== "clue" || !clueWord.trim()) return;
    if (loadingRef.current) return;
    updateLoading(true);
    setError(null);
    try {
      const teamAllowsUnknown = seats[game.turn].operatives.every((seat) => seat.controller === "human");
      const clueBase = commitRemainingDraft(game, game.turn, clueDraft);
      const analyzed = await api.analyzeClue(clueBase, clueWord.trim(), clueNumber, teamAllowsUnknown);
      setGame(clueBase);
      setTurnBase(clueBase);
      setClue(analyzed);
      pickedIndicesRef.current = [];
      setPickedIndices([]);
      setRemainingDraft({});
      resetVoting();
      setPhaseStartedAt(Date.now());
      setPhase("guess");
      setManualClue("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Эту подсказку нельзя использовать.");
    } finally {
      updateLoading(false);
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
    setPhaseStartedAt(Date.now());
    setPhase("result");
  }, [resetVoting]);

  const startAiGuess = useCallback(async () => {
    if (!turnBase || !clue || phase !== "guess" || loadingRef.current) return;
    updateLoading(true);
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
      updateLoading(false);
    }
  }, [acceptResolvedTurn, clue, loading, phase, tuning, turnBase]);

  const finishHumanGuess = useCallback(async (indices = pickedIndicesRef.current, stoppedEarly = true) => {
    if (!turnBase || !clue || phase !== "guess" || loadingRef.current) return;
    updateLoading(true);
    setError(null);
    try {
      const teamAllowsUnknown = seats[turnBase.turn].operatives.every((seat) => seat.controller === "human");
      const resolved = await api.resolveTurn(turnBase, clue.word, clue.number, indices, stoppedEarly, teamAllowsUnknown);
      await acceptResolvedTurn(turnBase, resolved, false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось применить ответы.");
    } finally {
      updateLoading(false);
    }
  }, [acceptResolvedTurn, clue, loading, phase, pickedIndices, seats, turnBase]);

  async function voteToFinish(voterSeatId: string) {
    if (!turnBase || !clue || phase !== "guess" || loadingRef.current) return;
    const operatives = seats[turnBase.turn].operatives;
    if (!operatives.some((seat) => seat.id === voterSeatId && seat.controller === "human")) return;

    const next = {
      ...finishVotesRef.current,
      [voterSeatId]: !finishVotesRef.current[voterSeatId]
    };
    if (next[voterSeatId]) {
      for (const operative of operatives) {
        if (operative.controller === "ai") next[operative.id] = true;
      }
    }
    finishVotesRef.current = next;
    setFinishVotes(next);
    setVoteMessage(next[voterSeatId] ? "Остановка ждёт согласия всей команды." : null);

    if (operatives.every((operative) => next[operative.id])) {
      setVoteMessage("Все оперативники согласились остановиться.");
      await delay(260);
      await finishHumanGuess(pickedIndicesRef.current, true);
    }
  }

  function revealHumanChoice(index: number) {
    if (!game || !turnBase || !clue || game.cards[index]?.revealed) return;
    const team = turnBase.turn;
    const nextPicks = [...pickedIndicesRef.current, index];
    const nextGame = previewReveal(game, index);
    const card = nextGame.cards[index];
    setGame(nextGame);
    pickedIndicesRef.current = nextPicks;
    setPickedIndices(nextPicks);
    resetVoting();

    const completesTeam = (card.role === "red" || card.role === "blue") && remainingForTeam(nextGame, card.role) === 0;
    const mustStop = card.role === "assassin" || card.role !== team || completesTeam;
    if (mustStop) void finishHumanGuess(nextPicks, false);
  }

  async function chooseCard(index: number, voterSeatId: string | null = null) {
    if (!game || !turnBase || !clue || phase !== "guess" || loadingRef.current || game.cards[index]?.revealed) return;
    const team = turnBase.turn;
    const operatives = seats[team].operatives;
    const humans = operatives.filter((seat) => seat.controller === "human");
    const aiOperatives = operatives.filter((seat) => seat.controller === "ai");

    if (Object.keys(finishVotesRef.current).length) {
      finishVotesRef.current = {};
      setFinishVotes({});
    }

    if (operatives.length === 1 && humans.length === 1) {
      revealHumanChoice(index);
      return;
    }

    const voter = humans.find((seat) => seat.id === voterSeatId) ?? humans[voteCursor] ?? humans[0];
    if (!voter) return;
    setVoteMessage(null);
    let round = castCardVote(votesRef.current, operatives.map((seat) => seat.id), voter.id, index);
    votesRef.current = round.votes;
    setVotes(round.votes);

    const humansComplete = humans.every((seat) => Number.isInteger(round.votes[seat.id]));
    if (!humansComplete) {
      setVoteCursor((cursor) => Math.min(cursor + 1, humans.length - 1));
      return;
    }

    let handedOffToResolution = false;
    try {
      if (aiOperatives.length && aiOperatives.some((operative) => !Number.isInteger(round.votes[operative.id]))) {
        updateLoading(true);
        const plan = await api.guesses(game, clue.word, clue.number, tuning[team].risk);
        setLastPlan(plan);
        const aiChoice = plan.picks[0]?.index;
        if (aiChoice === undefined) {
          setVoteMessage("ИИ предлагает остановиться. Карточка не открыта.");
          return;
        }
        for (const operative of aiOperatives) {
          if (!Number.isInteger(round.votes[operative.id])) {
            round = castCardVote(round.votes, operatives.map((seat) => seat.id), operative.id, aiChoice);
          }
        }
        votesRef.current = round.votes;
        setVotes(round.votes);
      }

      if (round.complete && round.consensusIndex !== null) {
        handedOffToResolution = true;
        updateLoading(false);
        await delay(260);
        revealHumanChoice(round.consensusIndex);
      } else {
        setVoteMessage("Голоса не совпали. Обсудите выбор и попробуйте ещё раз.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось собрать голоса команды.");
    } finally {
      if (!handedOffToResolution) updateLoading(false);
    }
  }

  const continueToNextTurn = useCallback(() => {
    setPhase("clue");
    setPhaseStartedAt(Date.now());
    setTurnBase(null);
    setClue(null);
    pickedIndicesRef.current = [];
    setPickedIndices([]);
    setLastRecord(null);
    setRemainingDraft({});
    resetVoting();
  }, [resetVoting]);

  useEffect(() => {
    if (!autoPlay || network.role === "guest" || !lobbyReady || !game || loading || game.winner) return;
    const visibleTeam = phase === "result" && lastRecord ? lastRecord.team : game.turn;
    let action: (() => void) | null = null;
    if (phase === "clue" && seats[visibleTeam].spymaster.controller === "ai") action = () => void requestAiClue();
    if (phase === "guess" && seats[visibleTeam].operatives.every((seat) => seat.controller === "ai")) action = () => void startAiGuess();
    if (phase === "result") action = continueToNextTurn;
    if (!action) return;
    const timer = window.setTimeout(action, phase === "result" ? 1100 : 720);
    return () => window.clearTimeout(timer);
  }, [autoPlay, continueToNextTurn, game, lastRecord, loading, lobbyReady, network.role, phase, requestAiClue, seats, startAiGuess]);

  const counts = game ? { red: remainingForTeam(game, "red"), blue: remainingForTeam(game, "blue") } : { red: 0, blue: 0 };
  const seatCounts = useMemo(() => {
    const players = allSeats(seats);
    return { humans: players.filter((seat) => seat.controller === "human").length, ai: players.filter((seat) => seat.controller === "ai").length };
  }, [seats]);

  function changeActiveTuning(patch: Partial<AiTuning[Team]>) {
    if (!canControlSystem) return;
    setTuning((current) => ({ ...current, [activeTeam]: { ...current[activeTeam], ...patch } }));
  }

  function applyRemainingDraft(record: TurnRecord, remaining: number) {
    setRemainingDraft((current) => ({
      ...current,
      [`${record.team}:${record.turn}`]: Math.max(0, Math.min(record.number, remaining))
    }));
  }

  function changeRemainingDraft(record: TurnRecord, remaining: number) {
    if (!canSubmitHumanClue) return;
    applyRemainingDraft(record, remaining);
  }

  function changeSeats(nextSeats: TeamSeats) {
    if (!canManageLobby) return;
    const cloned = cloneSeats(nextSeats);
    seatsRef.current = cloned;
    setSeats(cloned);
    if (network.role !== "offline") setAuthoritativeLobby(reconcileLobby(lobbyRef.current, cloned));
    resetVoting();
  }

  function changeLocalSeat(nextSeatId: string | null) {
    preferredNetworkSeatRef.current = nextSeatId;
    if (network.role === "offline") {
      setLocalSeatId(nextSeatId);
      return;
    }
    if (network.role === "guest") {
      reconnectClaimAttemptedRef.current = true;
      void network.sendCommand({ type: "claim-seat", seatId: nextSeatId });
      return;
    }
    const result = claimLobbySeat(lobbyRef.current, seatsRef.current, network.selfId, nextSeatId);
    if (result.accepted) {
      setAuthoritativeLobby(result.lobby);
      resetVoting();
    } else {
      setError(result.reason);
    }
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
          <button type="button" onClick={() => setPlayersOpen(true)}><span className="players-icon">♟♟</span> Настройка лобби <small>{seatCounts.humans} + {seatCounts.ai} ИИ</small></button>
        </nav>
      </header>

      <main id="game" className={`play-layout is-${activeTeam}${persistentSpymasterView ? " is-spymaster-view" : ""}`}>
        <section className="turn-baton">
          <div className="turn-baton__team"><span className={`team-beacon is-${activeTeam}`} /><strong>Ход {teamName(activeTeam)}</strong></div>
          <div className="turn-baton__message" key={`${activeTeam}-${phase}`}>
            <span>{phase === "clue" ? "Ведущий даёт подсказку" : phase === "guess" ? "Команда согласует карточки" : game?.winner ? `Победа ${teamName(game.winner)}` : "Команда завершила ход"}</span>
            <PhaseTimer enabled={timerEnabled} phase={phase} startedAt={phaseStartedAt} durationSeconds={phaseDurationSeconds} />
          </div>
          <div className="turn-baton__role">{phase === "clue" ? displaySeats[activeTeam].spymaster.name : phase === "guess" ? operativeNames(displaySeats, activeTeam) : "Переход хода"}</div>
        </section>

        <section className="board-area">
          {game ? (
            <Board
              cards={game.cards}
              clue={clue}
              showKey={showKey || persistentSpymasterView}
              showTrace={showTrace}
              interactive={Boolean(phase === "guess" && localOperativeCanAct && network.hostAvailable && !loading && !persistentSpymasterView)}
              currentTeam={activeTeam}
              voteMarkers={voteMarkers}
              localSeatId={localSeatId}
              onCardClick={(index) => dispatchHumanAction(
                { type: "choose-card", index, seatId: localSeatId ?? "" },
                () => void chooseCard(index, localSeatId)
              )}
            />
          ) : <div className="board-loading"><span />Раскладываю карточки…</div>}
        </section>

        <div className="game-sidebar">
          {game ? (
            <TurnPanel
              phase={phase}
              team={activeTeam}
              nextTeam={game.turn}
              seats={displaySeats}
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
              canControlSystem={canAdvanceSystem}
              canSubmitHumanClue={canSubmitHumanClue}
              canFinishHumanGuess={canFinishHumanGuess}
              canEditTuning={canControlSystem}
              hostAvailable={network.hostAvailable}
              lobbyReady={lobbyReady}
              onManualClueChange={setManualClue}
              onManualNumberChange={setManualNumber}
              onTuningChange={changeActiveTuning}
              onRemainingDraftChange={changeRemainingDraft}
              onSubmitClue={() => dispatchHumanAction(
                { type: "submit-clue", clue: manualClue, number: manualNumber, remainingDraft },
                () => void submitHumanClue()
              )}
              onRequestClue={() => { if (canAdvanceSystem) void requestAiClue(); }}
              onStartAiGuess={() => { if (canAdvanceSystem) void startAiGuess(); }}
              onFinishHumanGuess={() => dispatchHumanAction(
                { type: "finish-guess", seatId: localSeatId ?? "" },
                () => { if (localSeatId) void voteToFinish(localSeatId); }
              )}
              onContinue={() => { if (canAdvanceSystem) continueToNextTurn(); }}
              onNewGame={() => { if (canAdvanceSystem) void startNewGame(); }}
            />
          ) : null}
          {game ? <History history={game.history} /> : null}
        </div>
      </main>

      <button type="button" className="lab-fab" onClick={() => setDeveloperOpen(true)} aria-label="Открыть лабораторию">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M12 4h8M14 4v8L7.5 24.2A2.6 2.6 0 0 0 9.8 28h12.4a2.6 2.6 0 0 0 2.3-3.8L18 12V4" />
          <path d="M10.5 21h11" />
          <circle cx="14" cy="24" r="1" />
          <circle cx="19" cy="18" r="1" />
        </svg>
        <span>Лаборатория</span>
      </button>

      <PlayersModal
        open={playersOpen}
        seats={displaySeats}
        tuning={tuning}
        autoPlay={autoPlay}
        timerEnabled={timerEnabled}
        localSeatId={localSeatId}
        canManageLobby={canManageLobby}
        networkRole={network.role}
        networkRoomCode={network.roomCode}
        networkStatus={network.status}
        networkPeers={network.peers}
        networkParticipants={lobby.participants}
        onSeatsChange={changeSeats}
        onTuningChange={(nextTuning) => { if (canManageLobby) setTuning(nextTuning); }}
        onRulesChange={(rules) => {
          if (!canManageLobby) return;
          setAutoPlay(rules.autoPlay);
          if (rules.timerEnabled !== timerEnabled) setPhaseStartedAt(Date.now());
          setTimerEnabled(rules.timerEnabled);
        }}
        onLocalSeatChange={changeLocalSeat}
        onClose={() => setPlayersOpen(false)}
        onNewGame={() => { if (canControlSystem) void startNewGame(); }}
        onCreateRoom={network.create}
        onJoinRoom={async (code, name) => {
          setAuthoritativeLobby(EMPTY_LOBBY);
          preferredNetworkSeatRef.current = null;
          reconnectClaimAttemptedRef.current = true;
          await network.join(code, name);
          setLocalSeatId(null);
        }}
        onLeaveRoom={async () => {
          await network.leave();
          setAuthoritativeLobby(EMPTY_LOBBY);
          preferredNetworkSeatRef.current = null;
          reconnectClaimAttemptedRef.current = false;
          setLocalSeatId(null);
        }}
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
        onNewGame={() => { if (canControlSystem) void startNewGame(); }}
        onClose={() => setDeveloperOpen(false)}
      />

      {error ? <div className="error-toast" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Закрыть">×</button></div> : null}
    </div>
  );
}
