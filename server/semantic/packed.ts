import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SemanticMetadata } from "../../src/domain/types.js";
import { canonicalWord, type SemanticSpace } from "./space.js";

interface PackedMeta extends SemanticMetadata {
  formatVersion: 1;
}

interface PackedLexicon {
  words: string[];
  stems: string[];
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export class PackedSemanticSpace implements SemanticSpace {
  readonly metadata: SemanticMetadata;
  private readonly words: string[];
  private readonly stems: string[];
  private readonly vectors: Int8Array;
  private readonly norms: Float32Array;
  private readonly neighbors: Uint32Array;
  private readonly neighborScores: Int16Array;
  private readonly wordIndex = new Map<string, number>();
  private readonly boardIndices: number[];
  private readonly boardRows = new Map<number, number>();

  private constructor(
    metadata: PackedMeta,
    lexicon: PackedLexicon,
    vectors: Int8Array,
    norms: Float32Array,
    neighbors: Uint32Array,
    neighborScores: Int16Array,
    boardIndices: number[]
  ) {
    this.metadata = metadata;
    this.words = lexicon.words;
    this.stems = lexicon.stems;
    this.vectors = vectors;
    this.norms = norms;
    this.neighbors = neighbors;
    this.neighborScores = neighborScores;
    this.boardIndices = boardIndices;

    this.words.forEach((word, index) => this.wordIndex.set(canonicalWord(word), index));
    this.boardIndices.forEach((wordIndex, row) => this.boardRows.set(wordIndex, row));

    const expectedVectorBytes = metadata.vocabularySize * metadata.dimension;
    if (vectors.length !== expectedVectorBytes) {
      throw new Error(`Повреждён vectors.i8: ожидалось ${expectedVectorBytes} байт, получено ${vectors.length}.`);
    }
    if (norms.length !== metadata.vocabularySize) {
      throw new Error("Число норм в модели не совпадает со словарём.");
    }
    if (lexicon.words.length !== metadata.vocabularySize || lexicon.stems.length !== metadata.vocabularySize) {
      throw new Error("Размер лексикона модели не совпадает с метаданными.");
    }
    if (boardIndices.length !== metadata.boardWordCount) {
      throw new Error("Размер игрового словаря не совпадает с метаданными.");
    }
    const expectedNeighborCount = metadata.boardWordCount * metadata.neighborsPerBoardWord;
    if (neighbors.length !== expectedNeighborCount || neighborScores.length !== expectedNeighborCount) {
      throw new Error("Таблица ближайших соседей модели повреждена.");
    }
    if (boardIndices.some((index) => index >= metadata.vocabularySize)) {
      throw new Error("Игровой словарь содержит индекс за пределами лексикона.");
    }
  }

  static async load(modelDirectory: string): Promise<PackedSemanticSpace> {
    const [metaRaw, lexiconRaw, vectorsRaw, normsRaw, neighborsRaw, neighborScoresRaw, boardRaw] = await Promise.all([
      readFile(path.join(modelDirectory, "meta.json"), "utf8"),
      readFile(path.join(modelDirectory, "lexicon.json"), "utf8"),
      readFile(path.join(modelDirectory, "vectors.i8")),
      readFile(path.join(modelDirectory, "norms.f32")),
      readFile(path.join(modelDirectory, "neighbors.u32")),
      readFile(path.join(modelDirectory, "neighbor-scores.i16")),
      readFile(path.join(modelDirectory, "board.json"), "utf8")
    ]);

    const metadata = JSON.parse(metaRaw) as PackedMeta;
    const lexicon = JSON.parse(lexiconRaw) as PackedLexicon;
    const boardIndices = JSON.parse(boardRaw) as number[];
    return new PackedSemanticSpace(
      metadata,
      lexicon,
      new Int8Array(toArrayBuffer(vectorsRaw)),
      new Float32Array(toArrayBuffer(normsRaw)),
      new Uint32Array(toArrayBuffer(neighborsRaw)),
      new Int16Array(toArrayBuffer(neighborScoresRaw)),
      boardIndices
    );
  }

  hasWord(word: string): boolean {
    return this.wordIndex.has(canonicalWord(word));
  }

  similarity(first: string, second: string): number | null {
    const firstIndex = this.wordIndex.get(canonicalWord(first));
    const secondIndex = this.wordIndex.get(canonicalWord(second));
    if (firstIndex === undefined || secondIndex === undefined) return null;
    return this.similarityByIndex(firstIndex, secondIndex);
  }

  private similarityByIndex(firstIndex: number, secondIndex: number): number {
    const dimension = this.metadata.dimension;
    const firstOffset = firstIndex * dimension;
    const secondOffset = secondIndex * dimension;
    let dot = 0;
    for (let index = 0; index < dimension; index += 1) {
      dot += this.vectors[firstOffset + index] * this.vectors[secondOffset + index];
    }
    const denominator = this.norms[firstIndex] * this.norms[secondIndex];
    return denominator > 0 ? dot / denominator : 0;
  }

  nearestFor(word: string, limit = 128): string[] {
    return this.neighborsWithScores(word, limit).map(({ word: candidate }) => candidate);
  }

  neighborsWithScores(word: string, limit = 128): Array<{ word: string; score: number }> {
    const sourceIndex = this.wordIndex.get(canonicalWord(word));
    if (sourceIndex === undefined) return [];
    const row = this.boardRows.get(sourceIndex);
    if (row !== undefined) {
      const count = Math.min(limit, this.metadata.neighborsPerBoardWord);
      const offset = row * this.metadata.neighborsPerBoardWord;
      const result = new Array<{ word: string; score: number }>(count);
      for (let index = 0; index < count; index += 1) {
        result[index] = {
          word: this.words[this.neighbors[offset + index]],
          score: this.neighborScores[offset + index] / 32767
        };
      }
      return result;
    }

    return this.words
      .map((candidate, candidateIndex) => ({
        word: candidate,
        score: candidateIndex === sourceIndex ? -Infinity : this.similarityByIndex(sourceIndex, candidateIndex)
      }))
      .sort((first, second) => second.score - first.score)
      .slice(0, limit);
  }

  candidatePool(targetWords: readonly string[], perWord = 128): string[] {
    const candidates = new Set<string>();
    for (const targetWord of targetWords) {
      for (const candidate of this.nearestFor(targetWord, perWord)) candidates.add(candidate);
    }
    return [...candidates];
  }

  boardWords(): readonly string[] {
    return this.boardIndices.map((index) => this.words[index]);
  }

  stemOf(word: string): string {
    const index = this.wordIndex.get(canonicalWord(word));
    return index === undefined ? canonicalWord(word) : this.stems[index];
  }
}
