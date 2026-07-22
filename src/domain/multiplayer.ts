import type { ClueAmbition, OperativeProfile, Team } from "./types.js";

export type ControllerKind = "human" | "ai";
export type PlayerRole = "spymaster" | "operative" | "spectator";

export interface Participant {
  id: string;
  name: string;
  controller: ControllerKind;
  team: Team | null;
  role: PlayerRole;
  profile?: OperativeProfile;
  ambition?: ClueAmbition;
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
  id: string;
  controller: ControllerKind;
  name: string;
}

export type TeamSeats = Record<Team, {
  spymaster: SeatAssignment;
  operatives: SeatAssignment[];
}>;

export interface TeamAiTuning {
  ambition: ClueAmbition;
  risk: OperativeProfile;
}

export type AiTuning = Record<Team, TeamAiTuning>;
