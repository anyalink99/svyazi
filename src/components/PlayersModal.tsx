import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { AiTuning, ControllerKind, SeatAssignment, TeamSeats } from "../domain/multiplayer.js";
import { cloneSeats, DEFAULT_AI_TUNING } from "../domain/setup.js";
import type { ClueAmbition, OperativeProfile, Team } from "../domain/types.js";
import { useModalPresence } from "../hooks/useModalPresence.js";
import { ChoiceSelect, type ChoiceOption } from "./ChoiceSelect.js";

interface PlayersModalProps {
  open: boolean;
  seats: TeamSeats;
  tuning: AiTuning;
  localSeatId: string | null;
  onSeatsChange: (seats: TeamSeats) => void;
  onTuningChange: (tuning: AiTuning) => void;
  onLocalSeatChange: (seatId: string | null) => void;
  onClose: () => void;
  onNewGame: () => void;
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
  { value: "focused", label: "Точечно" },
  { value: "balanced", label: "Умеренно" },
  { value: "broad", label: "Широко" }
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
  onRemove
}: {
  label: string;
  value: SeatAssignment;
  local: boolean;
  removable?: boolean;
  onChange: (value: SeatAssignment) => void;
  onMakeLocal: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className={`seat-editor${local ? " is-local" : ""}`}>
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
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [draftSeats, setDraftSeats] = useState<TeamSeats>(() => cloneSeats(props.seats));
  const [draftTuning, setDraftTuning] = useState<AiTuning>(() => structuredClone(props.tuning));
  const [draftLocalSeatId, setDraftLocalSeatId] = useState<string | null>(props.localSeatId);
  const presence = useModalPresence(props.open, props.onClose);

  useEffect(() => {
    if (!props.open) return;
    setDraftSeats(cloneSeats(props.seats));
    setDraftTuning(structuredClone(props.tuning));
    setDraftLocalSeatId(props.localSeatId);
  }, [props.open]);

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
    setDraftSeats({
      ...draftSeats,
      [team]: { ...draftSeats[team], operatives: draftSeats[team].operatives.filter((_, seatIndex) => seatIndex !== index) }
    });
    if (removed.id === draftLocalSeatId) setDraftLocalSeatId(null);
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

  async function createRoom() {
    setCreatingRoom(true);
    try {
      const room = await api.createRoom("Хозяин комнаты");
      setRoomCode(room.code);
    } finally {
      setCreatingRoom(false);
    }
  }

  return (
    <div className={`modal-backdrop${presence.visible ? " is-visible" : ""}`} role="presentation" onMouseDown={props.onClose}>
      <section ref={presence.dialogRef} tabIndex={-1} className="game-modal players-modal" role="dialog" aria-modal="true" aria-labelledby="players-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div><span className="stage-kicker">Состав партии</span><h2 id="players-title">Игроки и роли</h2></div>
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

        <details className="room-foundation">
          <summary>Сетевая комната</summary>
          <div><span>Состав и голоса уже готовы; синхронизацию подключим следующим слоем.</span></div>
          {roomCode ? <code>{roomCode}</code> : <button type="button" aria-busy={creatingRoom} disabled={creatingRoom} onClick={() => void createRoom()}>{creatingRoom ? "Создаю…" : "Создать код"}</button>}
        </details>

        <footer className="modal-actions">
          <button className="game-action game-action--quiet" type="button" onClick={saveAndClose}>Сохранить и продолжить</button>
          <button className="game-action" type="button" onClick={saveAndStart}>Новое поле с этим составом</button>
        </footer>
      </section>
    </div>
  );
}
