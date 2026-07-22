import { useState } from "react";
import { api } from "../api.js";
import type { ControllerKind, SeatAssignment, TeamSeats } from "../domain/multiplayer.js";
import type { Team } from "../domain/types.js";
import { useModalPresence } from "../hooks/useModalPresence.js";

interface PlayersModalProps {
  open: boolean;
  seats: TeamSeats;
  onSeatsChange: (seats: TeamSeats) => void;
  onClose: () => void;
  onNewGame: () => void;
}

const PRESETS: Array<{ label: string; detail: string; seats: TeamSeats }> = [
  {
    label: "Я угадываю",
    detail: "ИИ ведёт обе команды, вы играете за красных",
    seats: {
      red: { spymaster: { controller: "ai", name: "ИИ-ведущий" }, operative: { controller: "human", name: "Вы" } },
      blue: { spymaster: { controller: "ai", name: "ИИ-ведущий" }, operative: { controller: "ai", name: "ИИ-оперативники" } }
    }
  },
  {
    label: "Я ведущий",
    detail: "Вы объясняете красным, остальные роли у ИИ",
    seats: {
      red: { spymaster: { controller: "human", name: "Вы" }, operative: { controller: "ai", name: "ИИ-оперативники" } },
      blue: { spymaster: { controller: "ai", name: "ИИ-ведущий" }, operative: { controller: "ai", name: "ИИ-оперативники" } }
    }
  },
  {
    label: "Вдвоём против ИИ",
    detail: "Один человек ведёт красных, второй угадывает",
    seats: {
      red: { spymaster: { controller: "human", name: "Ведущий красных" }, operative: { controller: "human", name: "Оперативники красных" } },
      blue: { spymaster: { controller: "ai", name: "ИИ-ведущий" }, operative: { controller: "ai", name: "ИИ-оперативники" } }
    }
  },
  {
    label: "Наблюдать",
    detail: "Все четыре роли играют автоматически",
    seats: {
      red: { spymaster: { controller: "ai", name: "Красный ИИ-ведущий" }, operative: { controller: "ai", name: "Красный ИИ-оперативник" } },
      blue: { spymaster: { controller: "ai", name: "Синий ИИ-ведущий" }, operative: { controller: "ai", name: "Синий ИИ-оперативник" } }
    }
  }
];

function SeatEditor({
  label,
  value,
  onChange
}: {
  label: string;
  value: SeatAssignment;
  onChange: (value: SeatAssignment) => void;
}) {
  return (
    <div className="seat-editor">
      <strong>{label}</strong>
      <select value={value.controller} onChange={(event) => onChange({ ...value, controller: event.target.value as ControllerKind })}>
        <option value="human">Человек</option>
        <option value="ai">ИИ</option>
      </select>
      <input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} aria-label={`Имя: ${label}`} />
    </div>
  );
}

export function PlayersModal(props: PlayersModalProps) {
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const presence = useModalPresence(props.open, props.onClose);
  if (!presence.mounted) return null;

  function updateSeat(team: Team, role: "spymaster" | "operative", value: SeatAssignment) {
    props.onSeatsChange({
      ...props.seats,
      [team]: { ...props.seats[team], [role]: value }
    });
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
            <button type="button" key={preset.label} onClick={() => props.onSeatsChange(structuredClone(preset.seats))}>
              <strong>{preset.label}</strong><span>{preset.detail}</span>
            </button>
          ))}
        </div>

        <div className="team-seats">
          {(["red", "blue"] as Team[]).map((team) => (
            <section className={`team-seat-card is-${team}`} key={team}>
              <h3>{team === "red" ? "Красная команда" : "Синяя команда"}</h3>
              <SeatEditor label="Ведущий" value={props.seats[team].spymaster} onChange={(value) => updateSeat(team, "spymaster", value)} />
              <SeatEditor label="Оперативники" value={props.seats[team].operative} onChange={(value) => updateSeat(team, "operative", value)} />
            </section>
          ))}
        </div>

        <section className="room-foundation">
          <div><strong>Сетевая комната</strong><span>REST-основа уже работает; синхронизация клиентов будет следующим слоем.</span></div>
          {roomCode ? <code>{roomCode}</code> : <button type="button" aria-busy={creatingRoom} disabled={creatingRoom} onClick={() => void createRoom()}>{creatingRoom ? "Создаю…" : "Создать код"}</button>}
        </section>

        <footer className="modal-actions">
          <button className="game-action game-action--quiet" type="button" onClick={props.onClose}>Продолжить партию</button>
          <button className="game-action" type="button" onClick={props.onNewGame}>Новое поле с этими ролями</button>
        </footer>
      </section>
    </div>
  );
}
