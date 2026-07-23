import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Board } from "../src/components/Board.js";
import { History } from "../src/components/History.js";
import type { CardState, TurnRecord } from "../src/domain/types.js";

const aiRecord: TurnRecord = {
  turn: 1,
  team: "red",
  clueGiver: "ai",
  clue: "космос",
  number: 2,
  targetWords: ["ракета", "звезда"],
  guesses: [],
  remaining: 2,
  endedBy: "stopped"
};

const humanRecord: TurnRecord = {
  ...aiRecord,
  turn: 2,
  team: "blue",
  clueGiver: "human",
  clue: "ручная",
  targetWords: ["секрет-человека"]
};

describe("endgame debrief", () => {
  it("shows the complete role key even when the regular key view is off", () => {
    const cards: CardState[] = [
      { word: "ракета", role: "red", revealed: false },
      { word: "река", role: "neutral", revealed: false },
      { word: "ночь", role: "assassin", revealed: true }
    ];
    const html = renderToStaticMarkup(
      <Board
        cards={cards}
        clue={null}
        showKey={false}
        gameOver
        showTrace={false}
        interactive={false}
        currentTeam="red"
        voteMarkers={[]}
        localSeatId={null}
        onCardClick={() => undefined}
      />
    );

    expect(html).toContain('aria-label="Финальный ключ"');
    expect(html).toContain('data-key-role="red"');
    expect(html).toContain('data-key-role="neutral"');
    expect(html).toContain("красная команда");
    expect(html).toContain("убийца");
  });

  it("declassifies only AI intentions and only after the game", () => {
    const liveHtml = renderToStaticMarkup(<History history={[aiRecord, humanRecord]} gameOver={false} />);
    const finalHtml = renderToStaticMarkup(<History history={[aiRecord, humanRecord]} gameOver />);

    expect(liveHtml).not.toContain("Имелись в виду");
    expect(finalHtml).toContain("Имелись в виду");
    expect(finalHtml).toContain("ракета");
    expect(finalHtml).toContain("звезда");
    expect(finalHtml).not.toContain("секрет-человека");
  });
});
