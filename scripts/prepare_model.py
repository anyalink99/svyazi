#!/usr/bin/env python3
"""Build a compact Russian semantic model for the game.

The script downloads Navec, selects frequent Russian lemmas, projects the
300-dimensional vectors to a smaller orthogonal space, quantizes them to int8,
and precomputes the nearest clue candidates for every board word.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import pymorphy3
import snowballstemmer
from navec import Navec
from wordfreq import top_n_list


MODEL_URL = (
    "https://storage.yandexcloud.net/natasha-navec/packs/"
    "navec_hudlit_v1_12B_500K_300d_100q.tar"
)
RUSSIAN_WORD = re.compile(r"^[а-яё]+$", re.IGNORECASE)
ALLOWED_CLUE_POS = {"NOUN", "ADJF", "ADJS", "VERB", "INFN", "ADVB"}
PROPER_GRAMMEMES = {"Name", "Surn", "Patr", "Geox", "Orgn", "Trad", "Abbr"}
BLOCKED_WORDS = {
    "этот",
    "который",
    "такой",
    "свой",
    "весь",
    "самый",
    "другой",
    "каждый",
    "любой",
    "некоторый",
    "никакой",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Подготовить локальную Navec-модель")
    parser.add_argument("--clues", type=int, default=50_000, help="размер словаря подсказок")
    parser.add_argument("--board", type=int, default=2_500, help="число слов для карточек")
    parser.add_argument("--dimension", type=int, default=128, help="размерность итоговых векторов")
    parser.add_argument("--neighbors", type=int, default=192, help="соседей на игровое слово")
    parser.add_argument("--scan", type=int, default=400_000, help="сколько частотных слов проверить")
    parser.add_argument("--batch", type=int, default=32, help="размер блока при поиске соседей")
    parser.add_argument("--seed", type=int, default=20260722, help="seed случайной проекции")
    parser.add_argument("--output", type=Path, default=Path("data/model"))
    parser.add_argument("--cache", type=Path, default=Path("data/cache"))
    return parser.parse_args()


def download(url: str, destination: Path) -> None:
    if destination.exists() and destination.stat().st_size > 1_000_000:
        print(f"Navec уже загружен: {destination}")
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "semantic-codenames/0.1"})
    print("Загружаю Navec (~51 МБ)…")
    with urllib.request.urlopen(request) as response, temporary.open("wb") as output:
        total = int(response.headers.get("Content-Length", "0"))
        downloaded = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            downloaded += len(chunk)
            if total:
                percent = downloaded * 100 // total
                print(f"\r  {percent:3d}%", end="", flush=True)
    if total:
        print()
    temporary.replace(destination)


def is_proper(parse: pymorphy3.analyzer.Parse) -> bool:
    return any(grammeme in parse.tag for grammeme in PROPER_GRAMMEMES)


def select_lexicon(
    navec: Navec,
    board_count: int,
    clue_count: int,
    scan_count: int,
) -> tuple[list[str], list[str], list[str]]:
    morph = pymorphy3.MorphAnalyzer()
    stemmer = snowballstemmer.stemmer("russian")
    board_words: list[str] = []
    clue_words: list[str] = []
    board_seen: set[str] = set()
    clue_seen: set[str] = set()
    source_words = top_n_list("ru", scan_count, wordlist="best", ascii_only=False)
    started = time.perf_counter()

    for position, source_word in enumerate(source_words, start=1):
        word = source_word.strip().lower()
        if not RUSSIAN_WORD.fullmatch(word) or not 3 <= len(word) <= 18:
            continue
        parse = morph.parse(word)[0]
        lemma = parse.normal_form.lower()
        if (
            lemma in BLOCKED_WORDS
            or not RUSSIAN_WORD.fullmatch(lemma)
            or not 3 <= len(lemma) <= 18
            or is_proper(parse)
            or lemma not in navec
        ):
            continue

        pos = parse.tag.POS
        if pos in ALLOWED_CLUE_POS and lemma not in clue_seen:
            clue_seen.add(lemma)
            clue_words.append(lemma)

        if pos == "NOUN" and len(board_words) < board_count and lemma not in board_seen:
            board_seen.add(lemma)
            board_words.append(lemma)

        if position % 10_000 == 0:
            print(
                f"\rОтбор слов: просмотрено {position:,}, "
                f"карточек {len(board_words):,}, подсказок {len(clue_words):,}",
                end="",
                flush=True,
            )
        if len(board_words) >= board_count and len(clue_words) >= clue_count:
            break

    print()
    if len(board_words) < board_count or len(clue_words) < clue_count:
        raise RuntimeError(
            "Не удалось набрать словарь. "
            f"Получено карточек={len(board_words)}, подсказок={len(clue_words)}. "
            "Увеличьте --scan."
        )

    board_words = board_words[:board_count]
    board_set = set(board_words)
    ordered_words = board_words + [word for word in clue_words if word not in board_set]
    ordered_words = ordered_words[:clue_count]
    if len(ordered_words) < clue_count:
        raise RuntimeError("После объединения не хватило уникальных подсказок.")
    stems = [stemmer.stemWord(word.replace("ё", "е")) for word in ordered_words]
    print(
        f"Словарь готов за {time.perf_counter() - started:.1f} с: "
        f"{len(board_words):,} карточек, {len(ordered_words):,} подсказок."
    )
    return ordered_words, stems, board_words


def build_vectors(
    navec: Navec,
    words: list[str],
    output_dimension: int,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    print("Распаковываю векторы Navec…")
    source = np.stack([np.asarray(navec[word], dtype=np.float32) for word in words])
    source /= np.maximum(np.linalg.norm(source, axis=1, keepdims=True), 1e-8)
    if output_dimension > source.shape[1]:
        raise ValueError("Итоговая размерность не может быть больше исходной.")

    print(f"Проецирую {source.shape[1]} -> {output_dimension} измерений…")
    random = np.random.default_rng(seed)
    projection_seed = random.standard_normal((source.shape[1], output_dimension), dtype=np.float32)
    projection, _ = np.linalg.qr(projection_seed, mode="reduced")
    projected = np.asarray(source @ projection, dtype=np.float32)
    projected /= np.maximum(np.linalg.norm(projected, axis=1, keepdims=True), 1e-8)

    quantized = np.clip(np.rint(projected * 127.0), -127, 127).astype(np.int8)
    norms = np.linalg.norm(quantized.astype(np.float32), axis=1).astype("<f4")
    return projected, quantized, norms


def looks_related_form(first: str, second: str, first_stem: str, second_stem: str) -> bool:
    if first == second or (len(first_stem) >= 3 and first_stem == second_stem):
        return True
    limit = min(len(first), len(second))
    prefix = 0
    while prefix < limit and first[prefix] == second[prefix]:
        prefix += 1
    return (prefix >= 4 and prefix / limit >= 0.78) or (
        limit <= 4 and prefix >= 3 and abs(len(first) - len(second)) <= 3
    )


def build_neighbors(
    projected: np.ndarray,
    words: list[str],
    stems: list[str],
    board_count: int,
    neighbor_count: int,
    batch_size: int,
) -> tuple[np.ndarray, np.ndarray]:
    if neighbor_count >= len(words):
        raise ValueError("Число соседей должно быть меньше словаря.")
    result_indices = np.empty((board_count, neighbor_count), dtype="<u4")
    result_scores = np.empty((board_count, neighbor_count), dtype="<i2")
    fetch_count = min(len(words), max(neighbor_count * 4, neighbor_count + 64))
    started = time.perf_counter()
    print(f"Считаю {neighbor_count} ближайших подсказок для {board_count:,} карточек…")

    for start in range(0, board_count, batch_size):
        end = min(board_count, start + batch_size)
        scores = projected[start:end] @ projected.T
        partition = np.argpartition(scores, -fetch_count, axis=1)[:, -fetch_count:]

        for local_row, board_index in enumerate(range(start, end)):
            indices = partition[local_row]
            indices = indices[np.argsort(scores[local_row, indices])[::-1]]
            selected: list[int] = []
            for candidate_index in indices.tolist():
                if looks_related_form(
                    words[board_index],
                    words[candidate_index],
                    stems[board_index],
                    stems[candidate_index],
                ):
                    continue
                selected.append(candidate_index)
                if len(selected) == neighbor_count:
                    break
            if len(selected) < neighbor_count:
                full_order = np.argsort(scores[local_row])[::-1]
                selected_set = set(selected)
                for candidate_index in full_order.tolist():
                    if candidate_index in selected_set or looks_related_form(
                        words[board_index],
                        words[candidate_index],
                        stems[board_index],
                        stems[candidate_index],
                    ):
                        continue
                    selected.append(candidate_index)
                    selected_set.add(candidate_index)
                    if len(selected) == neighbor_count:
                        break

            selected_array = np.asarray(selected, dtype=np.int64)
            result_indices[board_index] = selected_array.astype("<u4")
            result_scores[board_index] = np.clip(
                np.rint(scores[local_row, selected_array] * 32767.0), -32767, 32767
            ).astype("<i2")

        progress = end / board_count
        elapsed = time.perf_counter() - started
        eta = elapsed / max(progress, 1e-6) - elapsed
        print(
            f"\r  {progress * 100:5.1f}%  {end:,}/{board_count:,}  ETA {eta:5.0f} с",
            end="",
            flush=True,
        )
    print()
    print(f"Соседи рассчитаны за {time.perf_counter() - started:.1f} с.")
    return result_indices, result_scores


def write_model(
    output: Path,
    words: list[str],
    stems: list[str],
    board_words: list[str],
    quantized: np.ndarray,
    norms: np.ndarray,
    neighbors: np.ndarray,
    neighbor_scores: np.ndarray,
) -> None:
    output.mkdir(parents=True, exist_ok=True)
    board_indices = list(range(len(board_words)))
    metadata = {
        "formatVersion": 1,
        "kind": "navec",
        "source": "Navec hudlit v1, 12B tokens, 500K vocabulary",
        "dimension": int(quantized.shape[1]),
        "vocabularySize": len(words),
        "boardWordCount": len(board_words),
        "neighborsPerBoardWord": int(neighbors.shape[1]),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (output / "meta.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output / "lexicon.json").write_text(
        json.dumps({"words": words, "stems": stems}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    (output / "board.json").write_text(
        json.dumps(board_indices, separators=(",", ":")), encoding="utf-8"
    )
    quantized.astype(np.int8, copy=False).tofile(output / "vectors.i8")
    norms.astype("<f4", copy=False).tofile(output / "norms.f32")
    neighbors.astype("<u4", copy=False).tofile(output / "neighbors.u32")
    neighbor_scores.astype("<i2", copy=False).tofile(output / "neighbor-scores.i16")

    total_bytes = sum(path.stat().st_size for path in output.iterdir() if path.is_file())
    print(f"Модель записана в {output.resolve()} ({total_bytes / 1024 / 1024:.1f} МБ).")


def main() -> int:
    args = parse_args()
    if args.board < 25 or args.clues <= args.board:
        raise ValueError("Нужно минимум 25 карточек, а словарь подсказок должен быть больше.")
    if not 16 <= args.dimension <= 300:
        raise ValueError("Размерность должна быть от 16 до 300.")
    archive = args.cache / "navec_hudlit_v1_12B_500K_300d_100q.tar"
    download(MODEL_URL, archive)
    print("Загружаю Navec в память…")
    navec = Navec.load(str(archive))
    lexicon_cache = args.cache / f"lexicon_{args.board}_{args.clues}_{args.scan}.json"
    if lexicon_cache.exists():
        cached = json.loads(lexicon_cache.read_text(encoding="utf-8"))
        words = cached["words"]
        stems = cached["stems"]
        board_words = cached["boardWords"]
        print(f"Использую сохранённый словарь: {lexicon_cache}")
    else:
        words, stems, board_words = select_lexicon(
            navec, args.board, args.clues, args.scan
        )
        lexicon_cache.parent.mkdir(parents=True, exist_ok=True)
        lexicon_cache.write_text(
            json.dumps(
                {"words": words, "stems": stems, "boardWords": board_words},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
    projected, quantized, norms = build_vectors(navec, words, args.dimension, args.seed)
    neighbors, neighbor_scores = build_neighbors(
        projected,
        words,
        stems,
        len(board_words),
        args.neighbors,
        args.batch,
    )
    write_model(
        args.output,
        words,
        stems,
        board_words,
        quantized,
        norms,
        neighbors,
        neighbor_scores,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nОстановлено.", file=sys.stderr)
        raise SystemExit(130)
