export interface VoteRound {
  votes: Record<string, number>;
  consensusIndex: number | null;
  complete: boolean;
}

export function castCardVote(
  currentVotes: Readonly<Record<string, number>>,
  voterIds: readonly string[],
  voterId: string,
  cardIndex: number
): VoteRound {
  if (!voterIds.includes(voterId)) {
    throw new Error("Игрок не входит в состав оперативников этого хода.");
  }

  const votes = { ...currentVotes, [voterId]: cardIndex };
  const complete = voterIds.every((id) => Number.isInteger(votes[id]));
  if (!complete) return { votes, consensusIndex: null, complete: false };

  const choices = voterIds.map((id) => votes[id]);
  const consensusIndex = choices.every((index) => index === choices[0]) ? choices[0] : null;
  return { votes, consensusIndex, complete: true };
}
