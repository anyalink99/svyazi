import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoom, selfId, type MessageAction, type Room } from "trystero";
import type { LobbyState } from "../domain/lobby.js";
import type { PersistedSession } from "../domain/session.js";

export type NetworkRole = "offline" | "host" | "guest";

export type SharedSession = Omit<
  PersistedSession,
  | "localSeatId"
  | "manualClue"
  | "manualNumber"
  | "remainingDraft"
  | "showTrace"
  | "showKey"
> & { loading: boolean; lobby: LobbyState };

export type MultiplayerCommand =
  | { type: "claim-seat"; seatId: string | null; resume?: boolean }
  | { type: "submit-clue"; clue: string; number: number; remainingDraft: Record<string, number> }
  | { type: "finish-guess"; seatId: string }
  | { type: "choose-card"; index: number; seatId: string };

export interface PeerInfo {
  id: string;
  name: string;
}

interface P2POptions {
  getSnapshot: () => SharedSession | null;
  onSnapshot: (snapshot: SharedSession) => void;
  onCommand: (command: MultiplayerCommand, peerId: string) => void;
  onPeerIdentity: (peer: PeerInfo) => void;
  onPeerLeave: (peerId: string) => void;
  onNotice: (message: string) => void;
}

interface HelloMessage {
  name: string;
  role: "host" | "guest";
}

interface StateEnvelope {
  revision: number;
  snapshot: SharedSession;
}

interface NoticeMessage {
  message: string;
}

const APP_ID = "svyazi-semantic-codenames-v2";
const CONNECTION_STORAGE_KEY = "svyazi:network:v2";
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeCode(value: string): string {
  return value.toLocaleUpperCase("ru-RU").replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

function parseCommand(raw: string): MultiplayerCommand | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === "claim-seat" && (typeof value.seatId === "string" || value.seatId === null)) {
      return { type: "claim-seat", seatId: value.seatId, resume: value.resume === true };
    }
    if (value.type === "finish-guess" && typeof value.seatId === "string") {
      return { type: "finish-guess", seatId: value.seatId };
    }
    if (
      value.type === "choose-card" && Number.isInteger(value.index) &&
      (value.index as number) >= 0 && (value.index as number) < 25 && typeof value.seatId === "string"
    ) {
      return { type: "choose-card", index: value.index as number, seatId: value.seatId };
    }
    if (
      value.type === "submit-clue" && typeof value.clue === "string" && value.clue.trim().length > 0 &&
      value.clue.length <= 80 && Number.isInteger(value.number) && (value.number as number) >= 1 &&
      (value.number as number) <= 9 && typeof value.remainingDraft === "object" && value.remainingDraft !== null
    ) {
      const remainingDraft = Object.fromEntries(
        Object.entries(value.remainingDraft as Record<string, unknown>)
          .filter(([, remaining]) => Number.isInteger(remaining) && (remaining as number) >= 0 && (remaining as number) <= 9)
      ) as Record<string, number>;
      return { type: "submit-clue", clue: value.clue, number: value.number as number, remainingDraft };
    }
  } catch {
    // Ignore malformed traffic from peers. The host remains authoritative.
  }
  return null;
}

export function useP2PRoom(options: P2POptions) {
  const roomRef = useRef<Room | null>(null);
  const helloRef = useRef<MessageAction<string> | null>(null);
  const stateRef = useRef<MessageAction<string> | null>(null);
  const commandRef = useRef<MessageAction<string> | null>(null);
  const noticeRef = useRef<MessageAction<string> | null>(null);
  const optionsRef = useRef(options);
  const roleRef = useRef<NetworkRole>("offline");
  const nameRef = useRef("Игрок");
  const hostPeerRef = useRef<string | null>(null);
  const latestEnvelopeRef = useRef<StateEnvelope | null>(null);
  const lastAppliedRevisionRef = useRef(0);
  const [role, setRole] = useState<NetworkRole>("offline");
  const [localName, setLocalName] = useState("Игрок");
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState("Не подключено");
  const [hostAvailable, setHostAvailable] = useState(true);
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const leave = useCallback(async (forgetConnection = true) => {
    const room = roomRef.current;
    roomRef.current = null;
    helloRef.current = null;
    stateRef.current = null;
    commandRef.current = null;
    noticeRef.current = null;
    roleRef.current = "offline";
    hostPeerRef.current = null;
    latestEnvelopeRef.current = null;
    lastAppliedRevisionRef.current = 0;
    setRole("offline");
    setRoomCode("");
    setPeers([]);
    setHostAvailable(true);
    setStatus("Не подключено");
    if (forgetConnection) {
      try { window.localStorage.removeItem(CONNECTION_STORAGE_KEY); } catch { /* Storage is optional. */ }
    }
    if (room) await room.leave().catch(() => undefined);
  }, []);

  useEffect(() => () => {
    void roomRef.current?.leave();
  }, []);

  const connect = useCallback(async (codeValue: string, nextRole: "host" | "guest", name: string) => {
    const code = normalizeCode(codeValue);
    if (!code) throw new Error("Введите код комнаты.");
    await leave(false);
    const room = joinRoom({ appId: APP_ID }, code);
    const hello = room.makeAction<string>("hello");
    const state = room.makeAction<string>("state");
    const command = room.makeAction<string>("command");
    const notice = room.makeAction<string>("notice");
    roomRef.current = room;
    helloRef.current = hello;
    stateRef.current = state;
    commandRef.current = command;
    noticeRef.current = notice;
    roleRef.current = nextRole;
    nameRef.current = name.trim().slice(0, 24) || "Игрок";
    setLocalName(nameRef.current);
    setRole(nextRole);
    setRoomCode(code);
    setHostAvailable(nextRole === "host");
    setStatus(nextRole === "host" ? "Комната создана · ждём игроков" : "Ищем хозяина комнаты…");
    try {
      window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ code, role: nextRole, name: nameRef.current }));
    } catch {
      // Reconnection is optional when storage is unavailable.
    }

    async function sendLatestSnapshot(peerId: string) {
      if (roleRef.current !== "host") return;
      let envelope = latestEnvelopeRef.current;
      if (!envelope) {
        const snapshot = optionsRef.current.getSnapshot();
        if (!snapshot) return;
        envelope = { revision: 1, snapshot };
        latestEnvelopeRef.current = envelope;
      }
      await state.send(JSON.stringify(envelope), { target: peerId });
    }

    hello.onMessage = (rawMessage, context) => {
      try {
        const message = JSON.parse(rawMessage) as Partial<HelloMessage>;
        if (typeof message.name !== "string" || (message.role !== "host" && message.role !== "guest")) return;
        const peer = { id: context.peerId, name: message.name.trim().slice(0, 24) || "Игрок" };
        setPeers((current) => [...current.filter((entry) => entry.id !== peer.id), peer]);

        if (roleRef.current === "guest" && message.role === "host") {
          if (hostPeerRef.current && hostPeerRef.current !== context.peerId) return;
          hostPeerRef.current = context.peerId;
          setHostAvailable(true);
          setStatus("Соединение установлено");
        }
        if (roleRef.current === "host" && message.role === "guest") {
          optionsRef.current.onPeerIdentity(peer);
          setStatus("Игрок подключился");
          void sendLatestSnapshot(context.peerId);
        }
      } catch {
        // Ignore malformed hello messages.
      }
    };

    state.onMessage = (rawEnvelope, context) => {
      if (roleRef.current !== "guest") return;
      if (hostPeerRef.current && hostPeerRef.current !== context.peerId) return;
      try {
        const envelope = JSON.parse(rawEnvelope) as StateEnvelope;
        if (!Number.isInteger(envelope.revision) || envelope.revision <= lastAppliedRevisionRef.current || !envelope.snapshot?.game) return;
        hostPeerRef.current = context.peerId;
        lastAppliedRevisionRef.current = envelope.revision;
        setHostAvailable(true);
        optionsRef.current.onSnapshot(envelope.snapshot);
        setStatus("Партия синхронизирована");
      } catch {
        // Ignore malformed or incomplete snapshots.
      }
    };

    command.onMessage = (rawMessage, context) => {
      if (roleRef.current !== "host") return;
      const parsed = parseCommand(rawMessage);
      if (parsed) optionsRef.current.onCommand(parsed, context.peerId);
    };

    notice.onMessage = (rawMessage, context) => {
      if (roleRef.current !== "guest" || (hostPeerRef.current && hostPeerRef.current !== context.peerId)) return;
      try {
        const message = JSON.parse(rawMessage) as NoticeMessage;
        if (typeof message.message === "string") optionsRef.current.onNotice(message.message);
      } catch {
        // Ignore malformed notices.
      }
    };

    room.onPeerJoin = (peerId) => {
      setStatus(nextRole === "host" ? "Подключаем игрока…" : "Устанавливаем соединение…");
      void hello.send(JSON.stringify({ name: nameRef.current, role: roleRef.current === "host" ? "host" : "guest" } satisfies HelloMessage), { target: peerId });
      if (roleRef.current === "host") void sendLatestSnapshot(peerId);
    };

    room.onPeerLeave = (peerId) => {
      setPeers((current) => current.filter((peer) => peer.id !== peerId));
      if (roleRef.current === "host") optionsRef.current.onPeerLeave(peerId);
      if (hostPeerRef.current === peerId) {
        hostPeerRef.current = null;
        lastAppliedRevisionRef.current = 0;
        setHostAvailable(false);
        setStatus("Хозяин комнаты отключился · игра приостановлена");
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

  useEffect(() => {
    if (roleRef.current !== "offline") return;
    try {
      const raw = window.localStorage.getItem(CONNECTION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { code?: unknown; role?: unknown; name?: unknown };
      if (typeof saved.code !== "string" || (saved.role !== "host" && saved.role !== "guest") || typeof saved.name !== "string") return;
      void connect(saved.code, saved.role, saved.name).catch(() => {
        try { window.localStorage.removeItem(CONNECTION_STORAGE_KEY); } catch { /* Storage is optional. */ }
        setStatus("Не удалось восстановить сетевую комнату");
      });
    } catch {
      // Invalid saved data must not prevent offline play.
    }
  }, [connect]);

  const broadcastSnapshot = useCallback(async (snapshot: SharedSession) => {
    if (roleRef.current !== "host" || !stateRef.current) return;
    const envelope = {
      revision: (latestEnvelopeRef.current?.revision ?? 0) + 1,
      snapshot
    } satisfies StateEnvelope;
    latestEnvelopeRef.current = envelope;
    await stateRef.current.send(JSON.stringify(envelope));
  }, []);

  const sendCommand = useCallback(async (command: MultiplayerCommand) => {
    if (roleRef.current !== "guest" || !commandRef.current || !hostPeerRef.current) return;
    await commandRef.current.send(JSON.stringify(command), { target: hostPeerRef.current });
  }, []);

  const sendNotice = useCallback(async (peerId: string, message: string) => {
    if (roleRef.current !== "host" || !noticeRef.current) return;
    await noticeRef.current.send(JSON.stringify({ message } satisfies NoticeMessage), { target: peerId });
  }, []);

  return {
    selfId,
    role,
    localName,
    roomCode,
    status,
    hostAvailable,
    peers,
    create,
    join,
    leave,
    broadcastSnapshot,
    sendCommand,
    sendNotice
  };
}
