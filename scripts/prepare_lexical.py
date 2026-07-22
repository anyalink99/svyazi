#!/usr/bin/env python3
"""Extract a compact RuWordNet layer for the board vocabulary.

The browser does not need the full lexical database.  For every playable word
we retain only single-word relations that also exist in the packed Navec
lexicon.  Direct synonyms are strongest; hypernyms and domains are useful
human-readable Codenames clues, while part/whole relations are deliberately
weaker.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

from ruwordnet import RuWordNet


RUSSIAN_WORD = re.compile(r"^[а-яё]+$", re.IGNORECASE)
RELATION_WEIGHTS = {
    "hypernyms": 0.88,
    "domains": 0.82,
    "holonyms": 0.76,
    "meronyms": 0.76,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build compact RuWordNet relations")
    parser.add_argument("--model", type=Path, default=Path("data/model"))
    return parser.parse_args()


def usable(name: str, lexicon: set[str]) -> str | None:
    word = name.strip().lower()
    return word if RUSSIAN_WORD.fullmatch(word) and word in lexicon else None


def main() -> None:
    args = parse_args()
    lexicon_data = json.loads((args.model / "lexicon.json").read_text(encoding="utf-8"))
    words: list[str] = lexicon_data["words"]
    board_indices: list[int] = json.loads((args.model / "board.json").read_text(encoding="utf-8"))
    lexicon = set(words)
    wordnet = RuWordNet()
    database = wordnet.session.get_bind().url.database
    if not database:
        raise RuntimeError("RuWordNet database is unavailable; run `ruwordnet download` first")
    connection = sqlite3.connect(database)
    output: dict[str, list[list[str | float]]] = {}

    senses_by_synset: dict[str, list[str]] = {}
    synsets_by_word: dict[str, set[str]] = {}
    for name, lemma, synset_id in connection.execute("SELECT name, lemma, synset_id FROM sense"):
        lowered = name.lower()
        senses_by_synset.setdefault(synset_id, []).append(lowered)
        synsets_by_word.setdefault(lowered, set()).add(synset_id)
        synsets_by_word.setdefault(lemma.lower(), set()).add(synset_id)

    related_by_synset: dict[str, list[tuple[str, float]]] = {}
    relation_queries = (
        ("SELECT hyponym_id, hypernym_id FROM hypernym_relation", RELATION_WEIGHTS["hypernyms"]),
        ("SELECT domain_item_id, domain_id FROM domain_relation", RELATION_WEIGHTS["domains"]),
        ("SELECT meronym_id, holonym_id FROM meronymy_relation", RELATION_WEIGHTS["holonyms"]),
        ("SELECT holonym_id, meronym_id FROM meronymy_relation", RELATION_WEIGHTS["meronyms"]),
    )
    for query, weight in relation_queries:
        for source_id, target_id in connection.execute(query):
            related_by_synset.setdefault(source_id, []).append((target_id, weight))

    for index in board_indices:
        source = words[index]
        relations: dict[str, float] = {}
        for synset_id in synsets_by_word.get(source, ()):
            for name in senses_by_synset.get(synset_id, ()):
                candidate = usable(name, lexicon)
                if candidate and candidate != source:
                    relations[candidate] = max(relations.get(candidate, 0), 1.0)
            for related_id, weight in related_by_synset.get(synset_id, ()):
                for name in senses_by_synset.get(related_id, ()):
                    candidate = usable(name, lexicon)
                    if candidate and candidate != source:
                        relations[candidate] = max(relations.get(candidate, 0), weight)
        if relations:
            output[source] = [
                [candidate, weight]
                for candidate, weight in sorted(relations.items(), key=lambda item: (-item[1], item[0]))
            ]

    destination = args.model / "wordnet.json"
    destination.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    metadata_path = args.model / "meta.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["source"] = "Navec hudlit v1 + RuWordNet 2.0 lexical relations"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    relation_count = sum(len(items) for items in output.values())
    print(f"Wrote {relation_count} relations for {len(output)} board words to {destination}")


if __name__ == "__main__":
    main()
