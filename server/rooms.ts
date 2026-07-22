import { randomUUID } from "node:crypto";
import type {
  ControllerKind,
  GameRoom,
  Participant,
  PlayerRole
} from "../src/domain/multiplayer.js";
import type { OperativeProfile, Team } from "../src/domain/types.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function roomCode(): string {
  const source = randomUUID().replaceAll("-", "");
  let result = "";
  for (let index = 0; index < 5; index += 1) {
    result += CODE_ALPHABET[Number.parseInt(source.slice(index * 2, index * 2 + 2), 16) % CODE_ALPHABET.length];
  }
  return result;
}

export class RoomStore {
  private readonly rooms = new Map<string, GameRoom>();

  create(hostName: string): GameRoom {
    const host: Participant = {
      id: randomUUID(),
      name: hostName.trim() || "Игрок",
      controller: "human",
      team: "red",
      role: "operative",
      connected: true
    };
    const now = new Date().toISOString();
    let code = roomCode();
    while (this.rooms.has(code)) code = roomCode();
    const room: GameRoom = {
      id: randomUUID(),
      code,
      status: "lobby",
      hostId: host.id,
      participants: [host],
      gameId: null,
      createdAt: now,
      updatedAt: now
    };
    this.rooms.set(code, room);
    return structuredClone(room);
  }

  get(code: string): GameRoom {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new Error("Комната не найдена.");
    return structuredClone(room);
  }

  join(
    code: string,
    input: {
      name: string;
      controller?: ControllerKind;
      team?: Team | null;
      role?: PlayerRole;
      profile?: OperativeProfile;
    }
  ): GameRoom {
    const room = this.requireMutable(code);
    room.participants.push({
      id: randomUUID(),
      name: input.name.trim() || "Игрок",
      controller: input.controller ?? "human",
      team: input.team ?? null,
      role: input.role ?? "spectator",
      profile: input.profile,
      connected: true
    });
    room.updatedAt = new Date().toISOString();
    return structuredClone(room);
  }

  updateParticipant(
    code: string,
    participantId: string,
    patch: Partial<Pick<Participant, "name" | "controller" | "team" | "role" | "profile" | "connected">>
  ): GameRoom {
    const room = this.requireMutable(code);
    const participant = room.participants.find((item) => item.id === participantId);
    if (!participant) throw new Error("Игрок не найден в комнате.");
    Object.assign(participant, patch);
    participant.name = participant.name.trim() || "Игрок";
    room.updatedAt = new Date().toISOString();
    return structuredClone(room);
  }

  private requireMutable(code: string): GameRoom {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new Error("Комната не найдена.");
    if (room.status !== "lobby") throw new Error("Состав можно менять только в лобби.");
    return room;
  }
}
