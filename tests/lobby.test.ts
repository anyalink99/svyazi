import { describe, expect, it } from "vitest";
import {
  claimLobbySeat,
  lobbyIsReady,
  reconcileLobby,
  removeLobbyParticipant,
  type LobbyState
} from "../src/domain/lobby.js";
import { cloneSeats, DEFAULT_SEATS } from "../src/domain/setup.js";

function lobby(): LobbyState {
  return {
    participants: [
      { id: "host", name: "Хозяин", seatId: null, isHost: true },
      { id: "guest", name: "Гость", seatId: null, isHost: false }
    ]
  };
}

describe("authoritative lobby seats", () => {
  it("allows only one participant to claim a human seat", () => {
    const seats = cloneSeats(DEFAULT_SEATS);
    const first = claimLobbySeat(lobby(), seats, "host", "red-operative-you");
    const second = claimLobbySeat(first.lobby, seats, "guest", "red-operative-you");

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.lobby.participants.find((entry) => entry.id === "host")?.seatId).toBe("red-operative-you");
    expect(second.lobby.participants.find((entry) => entry.id === "guest")?.seatId).toBeNull();
  });

  it("releases a seat when its participant disconnects", () => {
    const seats = cloneSeats(DEFAULT_SEATS);
    const occupied = claimLobbySeat(lobby(), seats, "guest", "red-operative-you").lobby;
    const disconnected = removeLobbyParticipant(occupied, "guest");
    const reclaimed = claimLobbySeat(disconnected, seats, "host", "red-operative-you");

    expect(reclaimed.accepted).toBe(true);
  });

  it("drops claims when a host converts or removes a human seat", () => {
    const seats = cloneSeats(DEFAULT_SEATS);
    const occupied = claimLobbySeat(lobby(), seats, "guest", "red-operative-you").lobby;
    seats.red.operatives[0].controller = "ai";

    expect(reconcileLobby(occupied, seats).participants.find((entry) => entry.id === "guest")?.seatId).toBeNull();
  });

  it("reports a network lobby ready only when every human seat is occupied", () => {
    const seats = cloneSeats(DEFAULT_SEATS);
    expect(lobbyIsReady(lobby(), seats)).toBe(false);
    const occupied = claimLobbySeat(lobby(), seats, "host", "red-operative-you").lobby;
    expect(lobbyIsReady(occupied, seats)).toBe(true);
  });
});
