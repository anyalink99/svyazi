import type { SemanticMetadata } from "../domain/types.js";
import { canonicalWord, type SemanticSpace } from "../../server/semantic/space.js";

interface PackedMeta extends SemanticMetadata {
  formatVersion: 1;
}

interface PackedLexicon {
  words: string[];
  stems: string[];
}

type PackedWordNet = Record<string, Array<[word: string, score: number]>>;

async function fetchChecked(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить модель: ${response.status} ${url}`);
  return response;
}

function assetUrl(baseUrl: string, file: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${file}`;
}

export class BrowserPackedSemanticSpace implements SemanticSpace {
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
  private readonly wordNet: PackedWordNet;
  private readonly wordNetSpecificity = new Map<string, number>();

  private constructor(
    metadata: PackedMeta,
    lexicon: PackedLexicon,
    vectors: Int8Array,
    norms: Float32Array,
    neighbors: Uint32Array,
    neighborScores: Int16Array,
    boardIndices: number[],
    wordNet: PackedWordNet
  ) {
    this.metadata = metadata;
    this.words = lexicon.words;
    this.stems = lexicon.stems;
    this.vectors = vectors;
    this.norms = norms;
    this.neighbors = neighbors;
    this.neighborScores = neighborScores;
    this.boardIndices = boardIndices;
    this.wordNet = wordNet;
    const relationCounts = new Map<string, number>();
    for (const relations of Object.values(wordNet)) {
      for (const [candidate] of relations) relationCounts.set(candidate, (relationCounts.get(candidate) ?? 0) + 1);
    }
    const sourceCount = Object.keys(wordNet).length + 1;
    const denominator = Math.log(sourceCount);
    for (const [candidate, count] of relationCounts) {
      this.wordNetSpecificity.set(candidate, Math.max(0.15, Math.log(sourceCount / (count + 1)) / denominator));
    }
    this.words.forEach((word, index) => this.wordIndex.set(canonicalWord(word), index));
    this.boardIndices.forEach((wordIndex, row) => this.boardRows.set(wordIndex, row));
  }

  static async load(baseUrl: string): Promise<BrowserPackedSemanticSpace> {
    const files = ["meta.json", "lexicon.json", "vectors.i8", "norms.f32", "neighbors.u32", "neighbor-scores.i16", "board.json", "wordnet.json"];
    const responses = await Promise.all(files.map((file) => fetchChecked(assetUrl(baseUrl, file))));
    const [metadata, lexicon, vectors, norms, neighbors, neighborScores, boardIndices, wordNet] = await Promise.all([
      responses[0].json() as Promise<PackedMeta>,
      responses[1].json() as Promise<PackedLexicon>,
      responses[2].arrayBuffer().then((buffer) => new Int8Array(buffer)),
      responses[3].arrayBuffer().then((buffer) => new Float32Array(buffer)),
      responses[4].arrayBuffer().then((buffer) => new Uint32Array(buffer)),
      responses[5].arrayBuffer().then((buffer) => new Int16Array(buffer)),
      responses[6].json() as Promise<number[]>,
      responses[7].json() as Promise<PackedWordNet>
    ]);
    return new BrowserPackedSemanticSpace(metadata, lexicon, vectors, norms, neighbors, neighborScores, boardIndices, wordNet);
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
    return this.neighborsWithScores(word, limit).map((entry) => entry.word);
  }

  neighborsWithScores(word: string, limit = 128): Array<{ word: string; score: number }> {
    const sourceIndex = this.wordIndex.get(canonicalWord(word));
    if (sourceIndex === undefined) return [];
    const row = this.boardRows.get(sourceIndex);
    if (row !== undefined) {
      const count = Math.min(limit, this.metadata.neighborsPerBoardWord);
      const offset = row * this.metadata.neighborsPerBoardWord;
      return Array.from({ length: count }, (_, index) => ({
        word: this.words[this.neighbors[offset + index]],
        score: this.neighborScores[offset + index] / 32767
      }));
    }
    return this.words
      .map((candidate, candidateIndex) => ({
        word: candidate,
        score: candidateIndex === sourceIndex ? -Infinity : this.similarityByIndex(sourceIndex, candidateIndex)
      }))
      .sort((first, second) => second.score - first.score)
      .slice(0, limit);
  }

  lexicalNeighbors(word: string): Array<{ word: string; score: number }> {
    return (this.wordNet[canonicalWord(word)] ?? []).map(([candidate, score]) => ({ word: candidate, score }));
  }

  lexicalSpecificity(word: string): number {
    return this.wordNetSpecificity.get(canonicalWord(word)) ?? 1;
  }

  candidatePool(targetWords: readonly string[], perWord = 128): string[] {
    const candidates = new Set<string>();
    for (const word of targetWords) {
      for (const candidate of this.nearestFor(word, perWord)) candidates.add(candidate);
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
