import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { simulateGames } from "../server/simulation.js";
import { loadSemanticSpace } from "../server/semantic/load.js";

function readNumberFlag(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStringFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const games = Math.max(1, Math.floor(readNumberFlag("--games", 10_000)));
const seed = readNumberFlag("--seed", 20260722) >>> 0;
const output = readStringFlag("--output");
const semantic = await loadSemanticSpace();
let lastPercent = -1;

console.log(`Модель: ${semantic.metadata.source}`);
console.log(`Запускаю ${games.toLocaleString("ru-RU")} партий, seed=${seed}…`);

const summary = simulateGames(semantic, {
  games,
  seed,
  onProgress(completed, total) {
    const percent = Math.floor((completed / total) * 100);
    if (percent !== lastPercent && (percent % 5 === 0 || completed === total)) {
      process.stdout.write(`\r${String(percent).padStart(3, " ")}%  ${completed.toLocaleString("ru-RU")}/${total.toLocaleString("ru-RU")}`);
      lastPercent = percent;
    }
  }
});

process.stdout.write("\n");
console.log(JSON.stringify(summary, null, 2));

if (output) {
  const outputPath = path.resolve(process.cwd(), output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ model: semantic.metadata, simulation: summary }, null, 2)}\n`,
    "utf8"
  );
  console.log(`Отчёт сохранён: ${outputPath}`);
}
