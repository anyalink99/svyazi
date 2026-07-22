import { useEffect, useState } from "react";
import type { AiTuning, ControllerKind, SeatAssignment, TeamSeats } from "../domain/multiplayer.js";
import { cloneSeats, DEFAULT_AI_TUNING } from "../domain/setup.js";
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

interface SetupPreset {
  label: string;
  detail: string;
  seats: TeamSeats;
  localSeatId: string | null;
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

const PRESETS: SetupPreset[] = [
  {
    label: "Я угадываю",
    detail: "ИИ ведёт обе команды, вы играете за красных",
    localSeatId: "preset-red-you",
    seats: {
      red: { spymaster: { id: "preset-red-spy", controller: "ai", name: "ИИ-ведущий" }, operatives: [{ id: "preset-red-you", controller: "human", name: "Вы" }] },
      blue: { spymaster: { id: "preset-blue-spy", controller: "ai", name: "ИИ-ведущий" }, operatives: [{ id: "preset-blue-ai", controller: "ai", name: "ИИ-оперативник" }] }
    }
  },
  {
    label: "Я ведущий",
    detail: "Вы всегда видите ключ и объясняете красным",
    localSeatId: "preset-red-spy-you",
    seats: {
      red: { spymaster: { id: "preset-red-spy-you", controller: "human", name: "Вы" }, operatives: [{ id: "preset-red-ai", controller: "ai", name: "ИИ-оперативник" }] },
      blue: { spymaster: { id: "preset-blue-spy-2", controller: "ai", name: "ИИ-ведущий" }, operatives: [{ id: "preset-blue-ai-2", controller: "ai", name: "ИИ-оперативник" }] }
    }
  },
  {
    label: "Угадываем вдвоём",
    detail: "Два человека должны выбрать одну карточку",
    localSeatId: "preset-red-op-1",
    seats: {
      red: {
        spymaster: { id: "preset-red-spy-3", controller: "ai", name: "ИИ-ведущий" },
        operatives: [
          { id: "preset-red-op-1", controller: "human", name: "Игрок 1" },
          { id: "preset-red-op-2", controller: "human", name: "Игрок 2" }
        ]
      },
      blue: { spymaster: { id: "preset-blue-spy-3", controller: "ai", name: "ИИ-ведущий" }, operatives: [{ id: "preset-blue-ai-3", controller: "ai", name: "ИИ-оперативник" }] }
    }
  },
  {
    label: "Наблюдать",
    detail: "Все роли играют автоматически",
    localSeatId: null,
    seats: {
      red: { spymaster: { id: "preset-red-spy-4", controller: "ai", name: "Красный ИИ-ведущий" }, operatives: [{ id: "preset-red-ai-4", controller: "ai", name: "Красный ИИ-оперативник" }] },
      blue: { spymaster: { id: "preset-blue-spy-4", controller: "ai", name: "Синий ИИ-ведущий" }, operatives: [{ id: "preset-blue-ai-4", controller: "ai", name: "Синий ИИ-оперативник" }] }
    }
  }
];

function SeatEditor({
  label,
  value,
  local,
  removable,
  onChange,
  onMakeLocal,
  onRemove,
  removing = false
}: {
  label: string;
  value: SeatAssignment;
  local: boolean;
  removable?: boolean;
  onChange: (value: SeatAssignment) => void;
  onMakeLocal: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  return (
    <div className={`seat-editor${local ? " is-local" : ""}${removing ? " is-removing" : ""}`}>
      <strong>{label}</strong>
      <ChoiceSelect
        value={value.controller}
        options={CONTROLLER_OPTIONS}
        ariaLabel={`Тип игрока: ${label}`}
        onChange={(controller) => onChange({ ...value, controller })}
      />
      <input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} aria-label={`Имя: ${label}`} />
      {value.controller === "human" ? (
        <button
          className="local-seat-button"
          type="button"
          aria-pressed={local}
          onClick={onMakeLocal}
        >{local ? "✓ Это вы" : "Это вы"}</button>
      ) : <span className="local-seat-placeholder" aria-hidden="true" />}
      {removable ? <button className="remove-seat-button" type="button" onClick={onRemove} aria-label={`Удалить: ${label}`}>×</button> : null}
    </div>
  );
}

export function PlayersModal(props: PlayersModalProps) {
  const [networkName, setNetworkName] = useState("Игрок");
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
    }, 190);
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

        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <button type="button" key={preset.label} onClick={() => {
              setDraftSeats(cloneSeats(preset.seats));
              setDraftTuning(structuredClone(DEFAULT_AI_TUNING));
              setDraftLocalSeatId(preset.localSeatId);
            }}>
              <strong>{preset.label}</strong><span>{preset.detail}</span>
            </button>
          ))}
        </div>

        <div className="team-seats">
          {(["red", "blue"] as Team[]).map((team) => (
            <section className={`team-seat-card is-${team}`} key={team}>
              <h3>{team === "red" ? "Красная команда" : "Синяя команда"}</h3>
              <SeatEditor
                label="Ведущий"
                value={draftSeats[team].spymaster}
                local={draftLocalSeatId === draftSeats[team].spymaster.id}
                onChange={(value) => updateSpymaster(team, value)}
                onMakeLocal={() => setDraftLocalSeatId(draftSeats[team].spymaster.id)}
              />
              <div className="operative-roster">
                {draftSeats[team].operatives.map((operative, index) => (
                  <SeatEditor
                    key={operative.id}
                    label={`Оперативник ${index + 1}`}
                    value={operative}
                    local={draftLocalSeatId === operative.id}
                    removable={draftSeats[team].operatives.length > 1}
                    removing={removingSeatIds.has(operative.id)}
                    onChange={(value) => updateOperative(team, index, value)}
                    onMakeLocal={() => setDraftLocalSeatId(operative.id)}
                    onRemove={() => removeOperative(team, index)}
                  />
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
                  <label><span>Ваше имя</span><input value={networkName} maxLength={24} onChange={(event) => setNetworkName(event.target.value)} /></label>
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
