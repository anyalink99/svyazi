import type { SemanticMetadata } from "../../src/domain/types.js";

export interface SemanticSpace {
  readonly metadata: SemanticMetadata;
  hasWord(word: string): boolean;
  similarity(first: string, second: string): number | null;
  neighborsWithScores(word: string, limit?: number): Array<{ word: string; score: number }>;
  lexicalNeighbors(word: string): Array<{ word: string; score: number }>;
  lexicalSpecificity(word: string): number;
  nearestFor(word: string, limit?: number): string[];
  candidatePool(targetWords: readonly string[], perWord?: number): string[];
  boardWords(): readonly string[];
  stemOf(word: string): string;
}

export function canonicalWord(word: string): string {
  return word.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}
