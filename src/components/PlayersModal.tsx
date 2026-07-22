import { useEffect, useState } from "react";
import type { AiTuning, ControllerKind, SeatAssignment, TeamSeats } from "../domain/multiplayer.js";
import { allSeats, cloneSeats } from "../domain/setup.js";
import type { ClueAmbition, OperativeProfile, Team } from "../domain/types.js";
import { useModalPresence } from "../hooks/useModalPresence.js";
import type { NetworkRole, PeerInfo } from "../multiplayer/p2p.js";
import { ChoiceSelect, type ChoiceOption } from "./ChoiceSelect.js";

interface PlayersModalProps {
  open: boolean;
  seats: TeamSeats;
  tuning: AiTuning;
  localSeatId: string | null;
  networkRole: NetworkRole;
  networkRoomCode: string;
  networkStatus: string;
  networkPeers: PeerInfo[];
  onSeatsChange: (seats: TeamSeats) => void;
  onTuningChange: (tuning: AiTuning) => void;
  onLocalSeatChange: (seatId: string | null) => void;
  onClose: () => void;
  onNewGame: () => void;
  onCreateRoom: (name: string) => Promise<string>;
  onJoinRoom: (code: string, name: string) => Promise<void>;
  onLeaveRoom: () => Promise<void>;
}

const CONTROLLER_OPTIONS: ChoiceOption<ControllerKind>[] = [
  { value: "human", label: "Человек" },
  { value: "ai", label: "ИИ" }
];

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

function SeatEditor({
  label,
  value,
  local,
  removable,
  onChange,
  onMakeLocal,
  onRemove,
  occupiedBy = null
}: {
  label: string;
  value: SeatAssignment;
  local: boolean;
  removable?: boolean;
  onChange: (value: SeatAssignment) => void;
  onMakeLocal: () => void;
  onRemove?: () => void;
  occupiedBy?: string | null;
}) {
  return (
    <div className={`seat-editor${local ? " is-local" : ""}${occupiedBy ? " is-occupied" : ""}`}>
      <strong>{label}</strong>
      <ChoiceSelect
        value={value.controller}
        options={CONTROLLER_OPTIONS}
        ariaLabel={`Тип игрока: ${label}`}
        onChange={(controller) => onChange({ ...value, controller })}
      />
      {value.controller === "human" ? (
        <button
          className="claim-seat-button"
          type="button"
          aria-pressed={local}
          disabled={Boolean(occupiedBy) && !local}
          onClick={onMakeLocal}
        >{local ? `✓ ${value.name}` : occupiedBy ?? "Занять"}</button>
      ) : <input className="seat-name-input" value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} aria-label={`Имя: ${label}`} />}
      {removable ? <button className="remove-seat-button" type="button" onClick={onRemove} aria-label={`Удалить: ${label}`}>×</button> : null}
    </div>
  );
}

export function PlayersModal(props: PlayersModalProps) {
  const [networkName, setNetworkName] = useState(() => allSeats(props.seats).find((seat) => seat.id === props.localSeatId)?.name ?? "Игрок");
  const [networkCode, setNetworkCode] = useState("");
  const [networkBusy, setNetworkBusy] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [draftSeats, setDraftSeats] = useState<TeamSeats>(() => cloneSeats(props.seats));
  const [draftTuning, setDraftTuning] = useState<AiTuning>(() => structuredClone(props.tuning));
  const [draftLocalSeatId, setDraftLocalSeatId] = useState<string | null>(props.localSeatId);
  const [removingSeatIds, setRemovingSeatIds] = useState<Set<string>>(() => new Set());
  const [roomOpen, setRoomOpen] = useState(false);
  const presence = useModalPresence(props.open, props.onClose);

  useEffect(() => {
    if (!props.open) return;
    setDraftSeats(cloneSeats(props.seats));
    setDraftTuning(structuredClone(props.tuning));
    setDraftLocalSeatId(props.localSeatId);
    setRemovingSeatIds(new Set());
    setRoomOpen(props.networkRole !== "offline");
  }, [props.open]);

  useEffect(() => {
    if (!props.open || props.networkRole !== "guest") return;
    setDraftSeats(cloneSeats(props.seats));
    setDraftTuning(structuredClone(props.tuning));
    setDraftLocalSeatId(props.localSeatId);
  }, [props.localSeatId, props.networkRole, props.seats, props.tuning]);

  if (!presence.mounted) return null;

  function changeSeat(nextSeats: TeamSeats, changed: SeatAssignment) {
    setDraftSeats(nextSeats);
    if (changed.controller === "ai" && draftLocalSeatId === changed.id) setDraftLocalSeatId(null);
  }

  function updateSpymaster(team: Team, value: SeatAssignment) {
    changeSeat({ ...draftSeats, [team]: { ...draftSeats[team], spymaster: value } }, value);
  }

  function updateOperative(team: Team, index: number, value: SeatAssignment) {
    const operatives = draftSeats[team].operatives.map((seat, seatIndex) => seatIndex === index ? value : seat);
    changeSeat({ ...draftSeats, [team]: { ...draftSeats[team], operatives } }, value);
  }

  function addOperative(team: Team) {
    const id = `${team}-operative-${crypto.randomUUID()}`;
    setDraftSeats({
      ...draftSeats,
      [team]: {
        ...draftSeats[team],
        operatives: [...draftSeats[team].operatives, { id, controller: "human", name: `Игрок ${draftSeats[team].operatives.length + 1}` }]
      }
    });
  }

  function claimSeat(team: Team, role: "spymaster" | "operative", index = 0) {
    const nickname = networkName.trim() || "Игрок";
    if (role === "spymaster") {
      const seat = draftSeats[team].spymaster;
      updateSpymaster(team, { ...seat, name: nickname });
      setDraftLocalSeatId(seat.id);
      return;
    }
    const seat = draftSeats[team].operatives[index];
    updateOperative(team, index, { ...seat, name: nickname });
    setDraftLocalSeatId(seat.id);
  }

  function changeNetworkName(name: string) {
    setNetworkName(name);
    if (!draftLocalSeatId) return;
    const nickname = name.trim() || "Игрок";
    setDraftSeats((current) => ({
      red: {
        spymaster: current.red.spymaster.id === draftLocalSeatId ? { ...current.red.spymaster, name: nickname } : current.red.spymaster,
        operatives: current.red.operatives.map((seat) => seat.id === draftLocalSeatId ? { ...seat, name: nickname } : seat)
      },
      blue: {
        spymaster: current.blue.spymaster.id === draftLocalSeatId ? { ...current.blue.spymaster, name: nickname } : current.blue.spymaster,
        operatives: current.blue.operatives.map((seat) => seat.id === draftLocalSeatId ? { ...seat, name: nickname } : seat)
      }
    }));
  }

  function removeOperative(team: Team, index: number) {
    const removed = draftSeats[team].operatives[index];
    if (draftSeats[team].operatives.length <= 1) return;
    setRemovingSeatIds((current) => new Set(current).add(removed.id));
    window.setTimeout(() => {
      setDraftSeats((current) => ({
        ...current,
        [team]: { ...current[team], operatives: current[team].operatives.filter((seat) => seat.id !== removed.id) }
      }));
      setRemovingSeatIds((current) => {
        const next = new Set(current);
        next.delete(removed.id);
        return next;
      });
      if (removed.id === draftLocalSeatId) setDraftLocalSeatId(null);
    }, 240);
  }

  function updateTuning(team: Team, patch: Partial<AiTuning[Team]>) {
    setDraftTuning({ ...draftTuning, [team]: { ...draftTuning[team], ...patch } });
  }

  function commitDraft() {
    props.onSeatsChange(cloneSeats(draftSeats));
    props.onTuningChange(structuredClone(draftTuning));
    props.onLocalSeatChange(draftLocalSeatId);
  }

  function saveAndClose() {
    commitDraft();
    props.onClose();
  }

  function saveAndStart() {
    commitDraft();
    props.onNewGame();
  }

  async function createNetworkRoom() {
    setNetworkBusy(true);
    setNetworkError(null);
    try {
      await props.onCreateRoom(networkName);
    } catch (caught) {
      setNetworkError(caught instanceof Error ? caught.message : "Не удалось создать комнату.");
    } finally {
      setNetworkBusy(false);
    }
  }

  async function joinNetworkRoom() {
    setNetworkBusy(true);
    setNetworkError(null);
    try {
      await props.onJoinRoom(networkCode, networkName);
    } catch (caught) {
      setNetworkError(caught instanceof Error ? caught.message : "Не удалось войти в комнату.");
    } finally {
      setNetworkBusy(false);
    }
  }

  async function leaveNetworkRoom() {
    setNetworkBusy(true);
    setNetworkError(null);
    try {
      await props.onLeaveRoom();
    } finally {
      setNetworkBusy(false);
    }
  }

  return (
    <div className={`modal-backdrop${presence.visible ? " is-visible" : ""}`} role="presentation" onMouseDown={props.onClose}>
      <section ref={presence.dialogRef} tabIndex={-1} className="game-modal players-modal" role="dialog" aria-modal="true" aria-labelledby="players-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div><span className="stage-kicker">Состав партии</span><h2 id="players-title">Настройка лобби</h2></div>
          <button type="button" onClick={props.onClose} aria-label="Закрыть">×</button>
        </header>

        <div className="team-seats">
          {(["red", "blue"] as Team[]).map((team) => (
            <section className={`team-seat-card is-${team}`} key={team}>
              <h3>{team === "red" ? "Красная команда" : "Синяя команда"}</h3>
              <SeatEditor
                label="Ведущий"
                value={draftSeats[team].spymaster}
                local={draftLocalSeatId === draftSeats[team].spymaster.id}
                occupiedBy={props.networkPeers.find((peer) => peer.seatId === draftSeats[team].spymaster.id)?.name}
                onChange={(value) => updateSpymaster(team, value)}
                onMakeLocal={() => claimSeat(team, "spymaster")}
              />
              <div className="operative-roster">
                {draftSeats[team].operatives.map((operative, index) => (
                  <div className={`operative-slot${removingSeatIds.has(operative.id) ? " is-removing" : ""}`} key={operative.id}>
                    <div className="operative-slot__inner">
                      <SeatEditor
                        label={`Оперативник ${index + 1}`}
                        value={operative}
                        local={draftLocalSeatId === operative.id}
                        occupiedBy={props.networkPeers.find((peer) => peer.seatId === operative.id)?.name}
                        removable={draftSeats[team].operatives.length > 1}
                        onChange={(value) => updateOperative(team, index, value)}
                        onMakeLocal={() => claimSeat(team, "operative", index)}
                        onRemove={() => removeOperative(team, index)}
                      />
                    </div>
                  </div>
                ))}
                <button className="add-operative-button" type="button" onClick={() => addOperative(team)}>+ Добавить оперативника</button>
              </div>
              <div className="team-ai-settings">
                <div><span>Охват ведущего ИИ</span><ChoiceSelect value={draftTuning[team].ambition} options={AMBITION_OPTIONS} ariaLabel={`Охват ведущего ИИ, ${team}`} onChange={(ambition) => updateTuning(team, { ambition })} /></div>
                <div><span>Риск оперативников ИИ</span><ChoiceSelect value={draftTuning[team].risk} options={RISK_OPTIONS} ariaLabel={`Риск оперативников ИИ, ${team}`} onChange={(risk) => updateTuning(team, { risk })} /></div>
              </div>
            </section>
          ))}
        </div>

        <section className={`room-foundation${roomOpen ? " is-open" : ""}`}>
          <button className="room-foundation__summary" type="button" aria-expanded={roomOpen} onClick={() => setRoomOpen((current) => !current)}>
            <span>Сетевая комната</span><i aria-hidden="true" />
          </button>
          <div className="room-foundation__reveal" aria-hidden={!roomOpen} inert={!roomOpen ? true : undefined}>
            <div>
              {props.networkRole === "offline" ? (
                <div className="room-connect-form">
                  <label><span>Ваш ник</span><input value={networkName} maxLength={24} onChange={(event) => changeNetworkName(event.target.value)} /></label>
                  <button type="button" aria-busy={networkBusy} disabled={networkBusy} onClick={() => void createNetworkRoom()}>Создать комнату</button>
                  <span className="room-connect-form__or">или</span>
                  <label><span>Код комнаты</span><input className="room-code-input" value={networkCode} maxLength={8} placeholder="ABC123" onChange={(event) => setNetworkCode(event.target.value.toUpperCase())} /></label>
                  <button type="button" aria-busy={networkBusy} disabled={networkBusy || !networkCode.trim()} onClick={() => void joinNetworkRoom()}>Войти</button>
                </div>
              ) : (
                <div className="room-connected">
                  <div><span>{props.networkRole === "host" ? "Вы создали комнату" : "Вы подключены"}</span><code>{props.networkRoomCode}</code></div>
                  <strong>{props.networkStatus}</strong>
                  <span>{props.networkPeers.length ? `В сети: ${props.networkPeers.map((peer) => peer.name).join(", ")}` : "Ожидаем других игроков"}</span>
                  <button type="button" disabled={networkBusy} onClick={() => void leaveNetworkRoom()}>Покинуть комнату</button>
                </div>
              )}
              {networkError ? <p className="room-network-error" role="alert">{networkError}</p> : null}
            </div>
          </div>
        </section>

        <footer className="modal-actions">
          <button className="game-action game-action--quiet" type="button" onClick={saveAndClose}>Сохранить и продолжить</button>
          <button className="game-action" type="button" onClick={saveAndStart}>Новое поле с этим составом</button>
        </footer>
      </section>
    </div>
  );
}
