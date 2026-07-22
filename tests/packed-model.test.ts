import { beforeAll, describe, expect, it } from "vitest";
import { createGame } from "../src/domain/game.js";
import { runTurn } from "../server/ai/turn.js";
import { generateClue } from "../server/ai/spymaster.js";
import { planGuesses } from "../server/ai/operative.js";
import { PackedSemanticSpace } from "../server/semantic/packed.js";

describe("packed Navec model", () => {
  let semantic: PackedSemanticSpace;

  beforeAll(async () => {
    semantic = await PackedSemanticSpace.load("data/model");
  });

  it("loads the complete local model and plays a turn", async () => {
    expect(semantic.metadata.kind).toBe("navec");
    expect(semantic.metadata.vocabularySize).toBeGreaterThanOrEqual(50_000);
    expect(semantic.boardWords()).toHaveLength(2_500);
    expect(semantic.neighborsWithScores(semantic.boardWords()[0], 12)).toHaveLength(12);

    const state = createGame(semantic.boardWords(), 20260722, "red");
    const result = runTurn(semantic, state, {
      profile: "balanced",
      maxClueNumber: 4,
      neighborsPerTarget: 56
    });

    expect(result.clue.word.length).toBeGreaterThan(1);
    expect(result.clue.number).toBeGreaterThanOrEqual(1);
    expect(result.state.history).toHaveLength(1);
    expect(result.revealed.length).toBeGreaterThan(0);
  });

  it("prefers a direct lexical clue for a lone human-facing target", async () => {
    const target = "метрополитен";
    const directClues = new Set(["метро", "подземка"]);
    const filler = semantic.boardWords()
      .filter((word) => word !== target && !directClues.has(word) && word !== "транспорт")
      .slice(0, 24);
    const cards = [
      { word: target, role: "red" as const, revealed: false },
      ...filler.map((word, index) => ({
        word,
        role: index === 0 ? "assassin" as const : index < 9 ? "blue" as const : "neutral" as const,
        revealed: false
      }))
    ];

    const clue = generateClue(semantic, cards, "red", { maxNumber: 1 });

    expect(directClues.has(clue.word)).toBe(true);
    expect(clue.targetWords).toEqual([target]);
  });

  it("understands a colloquial human clue through its lexical meaning", async () => {
    const cards = ["сигнал", "мастерская", "пьяный"].map((word) => ({ word, revealed: false }));

    for (const profile of ["cautious", "balanced", "daring"] as const) {
      const plan = planGuesses(semantic, cards, "трудовик", 1, profile, 7);
      expect(plan.picks[0]?.word).toBe("мастерская");
    }
  });

  it("does not let a polysemous lexical bridge override a confident semantic cluster", () => {
    const words = [
      "нападение", "батальон", "падение", "молния", "несчастие",
      "мистер", "комитет", "администрация", "классификация", "звонок",
      "хобби", "капитан", "рисунок", "проход", "лес",
      "чемпионка", "легенда", "сержант", "слуга", "звезда",
      "сохранение", "ресторан", "голос", "фотограф", "определение"
    ];
    const expected = new Set(["капитан", "сержант", "батальон"]);

    for (const profile of ["cautious", "balanced", "daring"] as const) {
      for (const seed of [1, 7, 19, 31, 101, 997]) {
        const plan = planGuesses(
          semantic,
          words.map((word) => ({ word, revealed: false })),
          "военный",
          3,
          profile,
          seed
        );
        expect(new Set(plan.picks.slice(0, 3).map((pick) => pick.word))).toEqual(expected);
      }
    }
  });

  it("keeps relevant cards ahead of unrelated cards across independent topics", () => {
    const cases = [
      { clue: "космос", targets: ["ракета", "планета", "звезда"], distractors: ["хлеб", "река", "врач"] },
      { clue: "музыка", targets: ["гитара", "скрипка", "пианино"], distractors: ["поезд", "яблоко", "банк"] },
      { clue: "школа", targets: ["учитель", "ученик", "урок"], distractors: ["лес", "море", "монета"] },
      { clue: "медицина", targets: ["врач", "больница", "лекарство"], distractors: ["театр", "футбол", "дерево"] },
      { clue: "транспорт", targets: ["поезд", "автобус", "автомобиль"], distractors: ["кошка", "книга", "сыр"] },
      { clue: "спорт", targets: ["футбол", "хоккей", "стадион"], distractors: ["рыба", "картина", "завод"] },
      { clue: "животное", targets: ["кошка", "собака", "лошадь"], distractors: ["банк", "облако", "ложка"] },
      { clue: "кухня", targets: ["кастрюля", "сковорода", "плита"], distractors: ["самолет", "журнал", "дерево"] }
    ];

    for (const { clue, targets, distractors } of cases) {
      const cards = [...targets, ...distractors].map((word) => ({ word, revealed: false }));
      const expected = new Set(targets);
      for (const profile of ["cautious", "balanced", "daring"] as const) {
        for (const seed of [1, 7, 31]) {
          const plan = planGuesses(semantic, cards, clue, targets.length, profile, seed);
          expect(new Set(plan.picks.slice(0, targets.length).map((pick) => pick.word))).toEqual(expected);
        }
      }
    }
  });
});
