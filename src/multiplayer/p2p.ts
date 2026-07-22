import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, selfId, type MessageAction, type Room } from "trystero";
import type { AiTuning, TeamSeats } from "../domain/multiplayer.js";
import type { PersistedSession } from "../domain/session.js";
import type { Team, TurnRecord } from "../domain/types.js";

export type NetworkRole = "offline" | "host" | "guest";

export type SharedSession = Omit<
  PersistedSession,
  "localSeatId" | "manualClue" | "showTrace" | "showKey" | "autoPlay"
> & { loading: boolean };

export type MultiplayerCommand =
  | { type: "request-clue" }
  | { type: "submit-clue"; clue: string; number: number; remainingDraft: Record<string, number> }
  | { type: "start-ai-guess" }
  | { type: "finish-guess" }
  | { type: "choose-card"; index: number; seatId: string | null }
  | { type: "continue" }
  | { type: "new-game" }
  | { type: "tuning"; team: Team; patch: Partial<AiTuning[Team]> }
  | { type: "remaining"; record: TurnRecord; remaining: number }
  | { type: "seats"; seats: TeamSeats }
  | { type: "all-tuning"; tuning: AiTuning };

export interface PeerInfo {
  id: string;
  name: string;
}

interface P2POptions {
  getSnapshot: () => SharedSession | null;
  onSnapshot: (snapshot: SharedSession) => void;
  onCommand: (command: MultiplayerCommand, peerId: string) => void;
}

interface HelloMessage {
  name: string;
  role: "host" | "guest";
}

const APP_ID = "svyazi-semantic-codenames-v1";
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeCode(value: string): string {
  return value.toLocaleUpperCase("ru-RU").replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

export function useP2PRoom(options: P2POptions) {
  const roomRef = useRef<Room | null>(null);
  const helloRef = useRef<MessageAction<string> | null>(null);
  const stateRef = useRef<MessageAction<string> | null>(null);
  const commandRef = useRef<MessageAction<string> | null>(null);
  const optionsRef = useRef(options);
  const roleRef = useRef<NetworkRole>("offline");
  const nameRef = useRef("Игрок");
  const hostPeerRef = useRef<string | null>(null);
  const [role, setRole] = useState<NetworkRole>("offline");
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState("Не подключено");
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const leave = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    helloRef.current = null;
    stateRef.current = null;
    commandRef.current = null;
    roleRef.current = "offline";
    hostPeerRef.current = null;
    setRole("offline");
    setRoomCode("");
    setPeers([]);
    setStatus("Не подключено");
    if (room) await room.leave().catch(() => undefined);
  }, []);

  useEffect(() => () => {
    void roomRef.current?.leave();
  }, []);

  const connect = useCallback(async (codeValue: string, nextRole: "host" | "guest", name: string) => {
    const code = normalizeCode(codeValue);
    if (!code) throw new Error("Введите код комнаты.");
    await leave();
    const room = joinRoom({ appId: APP_ID }, code);
    const hello = room.makeAction<string>("hello");
    const state = room.makeAction<string>("state");
    const command = room.makeAction<string>("command");
    roomRef.current = room;
    helloRef.current = hello;
    stateRef.current = state;
    commandRef.current = command;
    roleRef.current = nextRole;
    nameRef.current = name.trim().slice(0, 24) || "Игрок";
    setRole(nextRole);
    setRoomCode(code);
    setStatus(nextRole === "host" ? "Комната создана · ждём игроков" : "Ищем комнату…");

    hello.onMessage = (rawMessage, context) => {
      const message = JSON.parse(rawMessage) as HelloMessage;
      setPeers((current) => [
        ...current.filter((peer) => peer.id !== context.peerId),
        { id: context.peerId, name: message.name || "Игрок" }
      ]);
      if (message.role === "host") hostPeerRef.current = context.peerId;
      setStatus("Соединение установлено");
      if (roleRef.current === "host") {
        const snapshot = optionsRef.current.getSnapshot();
        if (snapshot) void state.send(JSON.stringify(snapshot), { target: context.peerId });
      }
    };
    state.onMessage = (rawSnapshot, context) => {
      if (roleRef.current !== "guest") return;
      if (hostPeerRef.current && hostPeerRef.current !== context.peerId) return;
      hostPeerRef.current = context.peerId;
      optionsRef.current.onSnapshot(JSON.parse(rawSnapshot) as SharedSession);
      setStatus("Партия синхронизирована");
    };
    command.onMessage = (rawMessage, context) => {
      if (roleRef.current === "host") optionsRef.current.onCommand(JSON.parse(rawMessage) as MultiplayerCommand, context.peerId);
    };
    room.onPeerJoin = (peerId) => {
      setStatus("Подключаем игрока…");
      void hello.send(JSON.stringify({ name: nameRef.current, role: roleRef.current === "host" ? "host" : "guest" } satisfies HelloMessage), { target: peerId });
      if (roleRef.current === "host") {
        const snapshot = optionsRef.current.getSnapshot();
        if (snapshot) void state.send(JSON.stringify(snapshot), { target: peerId });
      }
    };
    room.onPeerLeave = (peerId) => {
      setPeers((current) => current.filter((peer) => peer.id !== peerId));
      if (hostPeerRef.current === peerId) {
        hostPeerRef.current = null;
        setStatus("Ведущий отключился");
      } else {
        setStatus("Игрок отключился");
      }
    };

    // Announce immediately for peers whose join callback raced with action setup.
    for (const peerId of Object.keys(room.getPeers())) {
      void hello.send(JSON.stringify({ name: nameRef.current, role: nextRole } satisfies HelloMessage), { target: peerId });
    }
  }, [leave]);

  const create = useCallback(async (name: string) => {
    const code = randomCode();
    await connect(code, "host", name);
    return code;
  }, [connect]);

  const join = useCallback((code: string, name: string) => connect(code, "guest", name), [connect]);

  const broadcastSnapshot = useCallback(async (snapshot: SharedSession) => {
    if (roleRef.current !== "host" || !stateRef.current) return;
    await stateRef.current.send(JSON.stringify(snapshot));
  }, []);

  const sendCommand = useCallback(async (command: MultiplayerCommand) => {
    if (roleRef.current !== "guest" || !commandRef.current) return;
    await commandRef.current.send(JSON.stringify(command), { target: hostPeerRef.current });
  }, []);

  return {
    selfId,
    role,
    roomCode,
    status,
    peers,
    create,
    join,
    leave,
    broadcastSnapshot,
    sendCommand
  };
}
