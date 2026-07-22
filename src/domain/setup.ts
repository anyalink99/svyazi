import type { AiTuning, SeatAssignment, TeamSeats } from "./multiplayer.js";
import type { Team } from "./types.js";

export const DEFAULT_SEATS: TeamSeats = {
  red: {
    spymaster: { id: "red-spymaster", controller: "ai", name: "ИИ-ведущий" },
    operatives: [{ id: "red-operative-you", controller: "human", name: "Вы" }]
  },
  blue: {
    spymaster: { id: "blue-spymaster", controller: "ai", name: "ИИ-ведущий" },
    operatives: [{ id: "blue-operative-ai", controller: "ai", name: "ИИ-оперативник" }]
  }
};

export const DEFAULT_AI_TUNING: AiTuning = {
  red: { ambition: "balanced", risk: "balanced" },
  blue: { ambition: "balanced", risk: "balanced" }
};

export function cloneSeats(seats: TeamSeats): TeamSeats {
  return {
    red: {
      spymaster: { ...seats.red.spymaster },
      operatives: seats.red.operatives.map((seat) => ({ ...seat }))
    },
    blue: {
      spymaster: { ...seats.blue.spymaster },
      operatives: seats.blue.operatives.map((seat) => ({ ...seat }))
    }
  };
}

export function allSeats(seats: TeamSeats): SeatAssignment[] {
  return (["red", "blue"] as Team[]).flatMap((team) => [
    seats[team].spymaster,
    ...seats[team].operatives
  ]);
}

export function seatTeamAndRole(
  seats: TeamSeats,
  seatId: string | null
): { team: Team; role: "spymaster" | "operative"; seat: SeatAssignment } | null {
  if (!seatId) return null;
  for (const team of ["red", "blue"] as Team[]) {
    if (seats[team].spymaster.id === seatId) {
      return { team, role: "spymaster", seat: seats[team].spymaster };
    }
    const operative = seats[team].operatives.find((seat) => seat.id === seatId);
    if (operative) return { team, role: "operative", seat: operative };
  }
  return null;
}

export function operativeNames(seats: TeamSeats, team: Team): string {
  const names = seats[team].operatives.map((seat) => seat.name.trim()).filter(Boolean);
  if (names.length <= 2) return names.join(" · ");
  return `${names[0]} и ещё ${names.length - 1}`;
}
