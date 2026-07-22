import type { TeamSeats } from "./multiplayer.js";
import { allSeats, cloneSeats, seatTeamAndRole } from "./setup.js";

export interface LobbyParticipant {
  id: string;
  name: string;
  seatId: string | null;
  isHost: boolean;
}

export interface LobbyState {
  participants: LobbyParticipant[];
}

export interface SeatClaimResult {
  lobby: LobbyState;
  accepted: boolean;
  reason: string | null;
}

export const EMPTY_LOBBY: LobbyState = { participants: [] };

export function normalizeParticipantName(value: string): string {
  return value.trim().slice(0, 24) || "Игрок";
}

export function upsertLobbyParticipant(
  lobby: LobbyState,
  participant: Omit<LobbyParticipant, "name"> & { name: string }
): LobbyState {
  const current = lobby.participants.find((entry) => entry.id === participant.id);
  const next: LobbyParticipant = {
    ...participant,
    name: normalizeParticipantName(participant.name),
    seatId: participant.seatId ?? current?.seatId ?? null
  };
  return {
    participants: [
      ...lobby.participants.filter((entry) => entry.id !== participant.id),
      next
    ]
  };
}

export function removeLobbyParticipant(lobby: LobbyState, participantId: string): LobbyState {
  return { participants: lobby.participants.filter((participant) => participant.id !== participantId) };
}

export function reconcileLobby(lobby: LobbyState, seats: TeamSeats): LobbyState {
  const validHumanSeatIds = new Set(
    allSeats(seats).filter((seat) => seat.controller === "human").map((seat) => seat.id)
  );
  const claimed = new Set<string>();
  return {
    participants: lobby.participants.map((participant) => {
      const seatId = participant.seatId;
      if (!seatId || !validHumanSeatIds.has(seatId) || claimed.has(seatId)) {
        return seatId ? { ...participant, seatId: null } : participant;
      }
      claimed.add(seatId);
      return participant;
    })
  };
}

export function claimLobbySeat(
  lobby: LobbyState,
  seats: TeamSeats,
  participantId: string,
  seatId: string | null
): SeatClaimResult {
  const participant = lobby.participants.find((entry) => entry.id === participantId);
  if (!participant) return { lobby, accepted: false, reason: "Игрок ещё не зарегистрирован в комнате." };

  if (seatId === null) {
    return {
      lobby: {
        participants: lobby.participants.map((entry) => entry.id === participantId ? { ...entry, seatId: null } : entry)
      },
      accepted: true,
      reason: null
    };
  }

  const seat = allSeats(seats).find((entry) => entry.id === seatId);
  if (!seat || seat.controller !== "human") {
    return { lobby, accepted: false, reason: "Это место недоступно для человека." };
  }
  const occupant = lobby.participants.find((entry) => entry.seatId === seatId && entry.id !== participantId);
  if (occupant) {
    return { lobby, accepted: false, reason: `Место уже занял ${occupant.name}.` };
  }

  return {
    lobby: {
      participants: lobby.participants.map((entry) => entry.id === participantId ? { ...entry, seatId } : entry)
    },
    accepted: true,
    reason: null
  };
}

export function participantSeat(lobby: LobbyState, seats: TeamSeats, participantId: string) {
  const seatId = lobby.participants.find((participant) => participant.id === participantId)?.seatId ?? null;
  return seatTeamAndRole(seats, seatId);
}

export function seatsWithLobbyNames(seats: TeamSeats, lobby: LobbyState): TeamSeats {
  const result = cloneSeats(seats);
  for (const participant of lobby.participants) {
    const assignment = seatTeamAndRole(result, participant.seatId);
    if (assignment?.seat.controller === "human") assignment.seat.name = participant.name;
  }
  return result;
}

export function lobbyIsReady(lobby: LobbyState, seats: TeamSeats): boolean {
  const occupied = new Set(lobby.participants.map((participant) => participant.seatId).filter(Boolean));
  return allSeats(seats).every((seat) => seat.controller === "ai" || occupied.has(seat.id));
}
