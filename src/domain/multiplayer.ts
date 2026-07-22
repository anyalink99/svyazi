import type { OperativeProfile, Team } from "./types.js";

export type ControllerKind = "human" | "ai";
export type PlayerRole = "spymaster" | "operative" | "spectator";

export interface Participant {
  id: string;
  name: string;
  controller: ControllerKind;
  team: Team | null;
  role: PlayerRole;
  profile?: OperativeProfile;
  connected: boolean;
}

export interface GameRoom {
  id: string;
  code: string;
  status: "lobby" | "playing" | "finished";
  hostId: string;
  participants: Participant[];
  gameId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SeatAssignment {
  controller: ControllerKind;
  name: string;
}

export type TeamSeats = Record<Team, {
  spymaster: SeatAssignment;
  operative: SeatAssignment;
}>;
