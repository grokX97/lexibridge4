#!/usr/bin/env python3
"""Build LexiBridge 10k EN/ZH/DE/FR concept-aligned corpus.

Hard rule: every accepted card must have English, Chinese, German and French
lemmas attached to the SAME WordNet/ILI concept. No independent bilingual
fallback is allowed, because that can silently mix senses across languages.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests
import wn

TARGET = 10_000
OUT = Path("vocab")
OUT.mkdir(exist_ok=True)

TOPICS = [
    "动作、变化与关系", "描述、性质与评价", "通用概念与实体", "心理与行为",
    "空间、时间与数量", "研究与证据", "健康、身体与医学", "经济与组织",
    "方式、程度与逻辑", "社会、法律与政治", "自然与环境", "语言、文化与艺术",
    "科学与技术", "评价与质量", "通用学术词汇", "系统与过程", "社会、制度与资源",
    "方法与推理", "时间与情境", "数据与测量", "沟通与认知", "变化与发展", "因果与影响",
]

POS_CODE = {"n": 0, "v": 1, "a": 2, "s": 2, "r": 3}
WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'-]{1,34}$")
BAD = {"fuck", "fucking", "shit", "bitch", "ass", "cunt", "dick", "porn"}
LEXICONS = {"zh": "omw-cmn:1.4", "de": "odenet:1.4", "fr": "omw-fr:1.4"}


def download_wordnets() -> None:
    for spec in ("omw-en:1.4", "omw-cmn:1.4", "omw-fr:1.4", "odenet:1.4"):
        print(f"Installing {spec}", flush=True)
        try:
            wn.download(spec)
        except Exception as exc:
            print(f"download note for {spec}: {exc}", file=sys.stderr)


def frequency_words() -> tuple[list[str], dict[str, tuple[int, int]]]:
    url = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"
    resp = requests.get(url, timeout=90)
    resp.raise_for_status()
    words: list[str] = []
    freq: dict[str, tuple[int, int]] = {}
    for line in resp.text.splitlines():
        try:
            word, count = line.rsplit(" ", 1)
            word = word.strip().lower()
            count_i = int(count)
        except Exception:
            continue
        if not WORD_RE.match(word) or word in BAD:
            continue
        if word not in freq:
            freq[word] = (len(freq) + 1, count_i)
            words.append(word)
    return words, freq


def clean_lemma(value: str, *, english: bool = False) -> str | None:
    value = str(value).replace("_", " ").strip()
    if not value or len(value) > 80:
        return None
    if english:
        value = value.lower()
        if " " in value or not WORD_RE.match(value) or value in BAD:
            return None
    return value


def unique(seq):
    out = []
    seen = set()
    for x in seq:
        if not x:
            continue
        k = x.casefold()
        if k in seen:
            continue
        seen.add(k)
        out.append(x)
    return out


def safe_examples(ss) -> list[str]:
    try:
        vals = ss.examples() or []
    except Exception:
        vals = []
    return unique([str(x).strip() for x in vals if str(x).strip() and len(str(x).strip()) <= 240])[:2]


def synset_bundle(ss, lexicon: str) -> dict | None:
    try:
        translated = ss.translate(lexicon=lexicon) or []
    except Exception:
        return None
    for tss in translated:
        try:
            lemmas = unique([clean_lemma(x) for x in tss.lemmas()])
        except Exception:
            lemmas = []
        lemmas = [x for x in lemmas if x]
        if not lemmas:
            continue
        examples = safe_examples(tss)
        return {"head": lemmas[0], "related": lemmas[1:5], "example": examples[0] if examples else ""}
    return None


def english_related(ss, word: str) -> list[str]:
    try:
        lemmas = unique([clean_lemma(x) for x in ss.lemmas()])
    except Exception:
        lemmas = []
    return [x for x in lemmas if x and x.casefold() != word.casefold()][:5]


def choose_aligned_synset(en, word: str):
    try:
        synsets = en.synsets(word)
    except Exception:
        return None
    for ss in synsets:
        if ss.pos not in POS_CODE:
            continue
        bundles = {lang: synset_bundle(ss, lex) for lang, lex in LEXICONS.items()}
        if all(bundles.values()):
            return ss, bundles
    return None


def level_code(rank: int) -> int:
    if rank <= 1500: return 0
    if rank <= 3000: return 1
    if rank <= 5000: return 2
    if rank <= 7000: return 3
    if rank <= 8500: return 4
    return 5


def topic_code(defn: str, pos: str) -> int:
    s = defn.lower()
    rules = [
        (6, ("disease", "medical", "body", "health", "blood", "tissue", "organ")),
        (12, ("science", "technology", "computer", "chemical", "physics", "energy")),
        (5, ("research", "evidence", "theory", "hypothesis", "study", "experiment")),
        (7, ("economic", "money", "business", "company", "trade", "market")),
        (9, ("law", "political", "government", "legal", "state", "authority")),
        (10, ("plant", "animal", "environment", "earth", "natural", "species")),
        (11, ("language", "music", "art", "literature", "speech", "writing")),
        (19, ("measure", "amount", "quantity", "data", "number", "rate")),
        (20, ("think", "know", "communicat", "understand", "belief", "memory")),
        (22, ("cause", "effect", "influence", "result", "consequence")),
        (21, ("develop", "change", "increase", "decrease", "grow", "transform")),
        (4, ("time", "space", "distance", "location", "period", "position")),
    ]
    for code, keys in rules:
        if any(k in s for k in keys):
            return code
    if pos == "v": return 0
    if pos in {"a", "s", "r"}: return 1
    return 2


def main() -> None:
    started = time.time()
    download_wordnets()
    en = wn.Wordnet("omw-en:1.4")
    words, freq = frequency_words()

    rows: list[list] = []
    seen: set[str] = set()
    strict_misses = 0

    candidates = list(words)
    extra = []
    for w in en.words():
        lemma = clean_lemma(w.lemma(), english=True)
        if lemma and lemma not in freq:
            extra.append(lemma)
    candidates.extend(sorted(set(extra)))

    for word in candidates:
        if len(rows) >= TARGET:
            break
        if word in seen:
            continue
        chosen = choose_aligned_synset(en, word)
        if chosen is None:
            strict_misses += 1
            continue
        ss, bundles = chosen
        try:
            definition = (ss.definition() or "").strip()
        except Exception:
            definition = ""
        if not definition:
            continue

        en_examples = safe_examples(ss)
        rank = len(rows) + 1
        f_rank, f_count = freq.get(word, (None, None))
        syn_id = str(getattr(ss, "id", rank))
        rows.append([
            word,
            POS_CODE.get(ss.pos, 0),
            level_code(rank),
            topic_code(definition, ss.pos),
            definition,
            bundles["zh"]["head"],
            bundles["de"]["head"],
            bundles["fr"]["head"],
            f_rank,
            f_count,
            syn_id,
            2,
            en_examples[0] if en_examples else "",
            bundles["zh"]["example"],
            bundles["de"]["example"],
            bundles["fr"]["example"],
            english_related(ss, word),
            bundles["zh"]["related"],
            bundles["de"]["related"],
            bundles["fr"]["related"],
        ])
        seen.add(word)
        if rank % 500 == 0:
            print(f"accepted {rank}/{TARGET}: {word}", flush=True)

    if len(rows) != TARGET:
        raise SystemExit(
            f"Could build only {len(rows)} strictly concept-aligned EN/ZH/DE/FR cards; "
            "refusing to reintroduce sense-mixing fallbacks"
        )

    for old in OUT.glob("part-*.js"):
        old.unlink()
    shard_size = 1000
    for i in range(0, TARGET, shard_size):
        shard = rows[i:i + shard_size]
        payload = json.dumps(shard, ensure_ascii=False, separators=(",", ":"))
        (OUT / f"part-{i // shard_size:02d}.js").write_text(
            "window.LB4_ROWS=window.LB4_ROWS||[];window.LB4_ROWS.push(..." + payload + ");\n",
            encoding="utf-8",
        )

    meta = (
        "window.LB4_TOPICS=" + json.dumps(TOPICS, ensure_ascii=False, separators=(",", ":")) +
        ";window.LB4_ROWS=[];window.LB4_SCHEMA=2;\n"
    )
    (OUT / "meta.js").write_text(meta, encoding="utf-8")
    audit = {
        "cards": len(rows),
        "uniqueEnglish": len(seen),
        "shards": 10,
        "frequencyRanked": sum(1 for r in rows if r[8] is not None),
        "strictSameConceptAllFourLanguages": True,
        "independentBilingualFallbacks": False,
        "strictMissesBeforeTarget": strict_misses,
        "naturalEnglishExampleCards": sum(1 for r in rows if r[12]),
        "naturalZhExampleCards": sum(1 for r in rows if r[13]),
        "naturalDeExampleCards": sum(1 for r in rows if r[14]),
        "naturalFrExampleCards": sum(1 for r in rows if r[15]),
        "sources": ["omw-en:1.4", "omw-cmn:1.4", "omw-fr:1.4", "odenet:1.4", "FrequencyWords"],
        "seconds": round(time.time() - started, 1),
    }
    (OUT / "BUILD_AUDIT.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
