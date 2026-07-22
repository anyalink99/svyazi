import { describe, expect, it } from "vitest";
import { castCardVote } from "../src/domain/voting.js";

describe("operative consensus", () => {
  it("opens a card only after every operative selects the same index", () => {
    const voters = ["alice", "boris"];
    const first = castCardVote({}, voters, "alice", 7);
    expect(first.complete).toBe(false);
    expect(first.consensusIndex).toBeNull();

    const second = castCardVote(first.votes, voters, "boris", 7);
    expect(second.complete).toBe(true);
    expect(second.consensusIndex).toBe(7);
  });

  it("keeps a card closed when votes differ", () => {
    const voters = ["alice", "boris"];
    const first = castCardVote({}, voters, "alice", 7);
    const second = castCardVote(first.votes, voters, "boris", 8);
    expect(second.complete).toBe(true);
    expect(second.consensusIndex).toBeNull();
  });
});
