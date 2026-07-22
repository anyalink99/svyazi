import { hashString, mulberry32 } from "../../src/domain/random.js";
import type { SemanticMetadata } from "../../src/domain/types.js";
import { canonicalWord, type SemanticSpace } from "./space.js";

const GROUPS: Record<string, string[]> = {
  космос: ["космос", "ракета", "звезда", "планета", "спутник", "орбита", "луна", "астронавт", "телескоп", "галактика"],
  вода: ["вода", "море", "океан", "река", "озеро", "дождь", "волна", "берег", "корабль", "рыба", "плавание"],
  холод: ["холод", "лёд", "снег", "зима", "мороз", "метель", "айсберг", "север", "коньки", "холодильник"],
  огонь: ["огонь", "пожар", "пламя", "печь", "свеча", "спичка", "дым", "вулкан", "жара", "уголь"],
  животные: ["животное", "кошка", "собака", "тигр", "лев", "медведь", "волк", "лиса", "мышь", "лошадь", "заяц"],
  птицы: ["птица", "орёл", "ворона", "голубь", "сова", "крыло", "перо", "гнездо", "полёт"],
  город: ["город", "москва", "париж", "улица", "метро", "площадь", "башня", "мост", "столица", "дом"],
  музыка: ["музыка", "гитара", "пианино", "скрипка", "барабан", "песня", "нота", "оркестр", "концерт", "голос"],
  наука: ["наука", "атом", "формула", "физика", "химия", "лаборатория", "учёный", "опыт", "теория", "микроскоп"],
  техника: ["техника", "компьютер", "робот", "машина", "телефон", "экран", "кнопка", "двигатель", "кабель", "сервер"],
  еда: ["еда", "хлеб", "сыр", "яблоко", "суп", "торт", "молоко", "мёд", "соль", "перец", "тарелка"],
  растения: ["растение", "дерево", "цветок", "трава", "лес", "лист", "корень", "семя", "сад", "дуб"],
  время: ["время", "часы", "минута", "секунда", "календарь", "век", "утро", "вечер", "прошлое", "будущее"],
  деньги: ["деньги", "банк", "монета", "рубль", "золото", "рынок", "цена", "кошелёк", "кредит", "богатство"],
  школа: ["школа", "книга", "учитель", "ученик", "урок", "доска", "ручка", "тетрадь", "экзамен", "знание"],
  спорт: ["спорт", "мяч", "футбол", "хоккей", "гол", "стадион", "тренер", "бег", "победа", "команда"],
  медицина: ["медицина", "врач", "больница", "лекарство", "сердце", "кровь", "операция", "болезнь", "здоровье", "пациент"],
  власть: ["власть", "король", "президент", "закон", "суд", "армия", "война", "мир", "граница", "страна"],
  театр: ["театр", "актёр", "сцена", "маска", "кино", "роль", "зритель", "билет", "драма", "камера"],
  путешествие: ["путешествие", "поезд", "самолёт", "дорога", "вокзал", "чемодан", "карта", "турист", "остров", "пустыня"]
};

function roughStem(value: string): string {
  const word = canonicalWord(value);
  return word.replace(/(иями|ями|ами|ого|ему|ому|ыми|ими|ей|ий|ый|ая|яя|ое|ее|ов|ев|ом|ам|ах|ях|ы|и|а|я|у|ю|е|о)$/u, "");
}

export class DemoSemanticSpace implements SemanticSpace {
  readonly metadata: SemanticMetadata;
  private readonly words: string[];
  private readonly wordToVector = new Map<string, Float32Array>();
  private readonly boardVocabulary: string[];
  private readonly neighborCache = new Map<string, Array<{ word: string; score: number }>>();

  constructor() {
    const groupNames = Object.keys(GROUPS);
    const dimension = groupNames.length + 12;
    const memberships = new Map<string, number[]>();

    groupNames.forEach((groupName, groupIndex) => {
      GROUPS[groupName].forEach((word) => {
        const key = canonicalWord(word);
        const list = memberships.get(key) ?? [];
        list.push(groupIndex);
        memberships.set(key, list);
      });
    });

    this.words = [...memberships.keys()];
    this.boardVocabulary = this.words.filter((word) => !groupNames.includes(word));

    for (const word of this.words) {
      const vector = new Float32Array(dimension);
      for (const groupIndex of memberships.get(word) ?? []) vector[groupIndex] = 1;
      const random = mulberry32(hashString(word));
      for (let index = groupNames.length; index < dimension; index += 1) {
        vector[index] = (random() - 0.5) * 0.16;
      }
      let norm = 0;
      for (const value of vector) norm += value * value;
      norm = Math.sqrt(norm) || 1;
      for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
      this.wordToVector.set(word, vector);
    }

    for (const word of this.words) {
      const source = this.wordToVector.get(word)!;
      const neighbors = this.words
        .filter((candidate) => candidate !== word)
        .map((candidate) => {
          const target = this.wordToVector.get(candidate)!;
          let score = 0;
          for (let index = 0; index < source.length; index += 1) score += source[index] * target[index];
          return { word: candidate, score };
        })
        .sort((first, second) => second.score - first.score);
      this.neighborCache.set(word, neighbors);
    }

    this.metadata = {
      kind: "demo",
      source: "Встроенный демонстрационный словарь",
      dimension,
      vocabularySize: this.words.length,
      boardWordCount: this.boardVocabulary.length,
      neighborsPerBoardWord: this.words.length
    };
  }

  hasWord(word: string): boolean {
    return this.wordToVector.has(canonicalWord(word));
  }

  similarity(first: string, second: string): number | null {
    const firstVector = this.wordToVector.get(canonicalWord(first));
    const secondVector = this.wordToVector.get(canonicalWord(second));
    if (!firstVector || !secondVector) return null;
    let dot = 0;
    for (let index = 0; index < firstVector.length; index += 1) {
      dot += firstVector[index] * secondVector[index];
    }
    return dot;
  }

  nearestFor(word: string, limit = 128): string[] {
    return this.neighborsWithScores(word, limit).map(({ word: candidate }) => candidate);
  }

  neighborsWithScores(word: string, limit = 128): Array<{ word: string; score: number }> {
    return this.neighborCache.get(canonicalWord(word))?.slice(0, limit) ?? [];
  }

  lexicalNeighbors(): Array<{ word: string; score: number }> {
    return [];
  }

  candidatePool(targetWords: readonly string[], perWord = 128): string[] {
    const candidates = new Set<string>();
    for (const word of targetWords) {
      for (const candidate of this.nearestFor(word, perWord)) candidates.add(candidate);
    }
    return [...candidates];
  }

  boardWords(): readonly string[] {
    return this.boardVocabulary;
  }

  stemOf(word: string): string {
    return roughStem(word);
  }
}
