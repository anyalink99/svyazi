import { describe, expect, it } from "vitest";
import { RoomStore } from "../server/rooms.js";

describe("multiplayer room foundation", () => {
  it("creates a room, joins players and assigns a role", () => {
    const rooms = new RoomStore();
    const created = rooms.create("Алиса");
    expect(created.code).toHaveLength(5);
    expect(created.participants[0].name).toBe("Алиса");

    const joined = rooms.join(created.code, {
      name: "Борис",
      team: "blue",
      role: "spymaster"
    });
    const boris = joined.participants.find((player) => player.name === "Борис")!;
    expect(boris.team).toBe("blue");
    expect(boris.role).toBe("spymaster");

    const updated = rooms.updateParticipant(created.code, boris.id, { role: "operative" });
    expect(updated.participants.find((player) => player.id === boris.id)?.role).toBe("operative");
  });
});
