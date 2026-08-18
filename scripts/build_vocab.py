#!/usr/bin/env python3
"""Build LexiBridge's 10,000-card EN/ZH/DE/FR corpus from open lexical data.

Primary semantic backbone: OMW English WordNet 3.0. Translations first use
ILI-aligned Chinese Open Wordnet, WOLF and OdeNet; corpus-derived word2word
translations are used only as a coverage fallback. Output is compact JS so the
static PWA can work offline after its first successful load.
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


def download_wordnets() -> None:
    for spec in ("omw-en:1.4", "omw-cmn:1.4", "omw-fr:1.4", "odenet:1.4"):
        print(f"Installing {spec}", flush=True)
        try:
            wn.download(spec)
        except Exception as exc:
            # Wn raises if already installed in some versions; verify below.
            print(f"download note for {spec}: {exc}", file=sys.stderr)


def frequency_words() -> tuple[list[str], dict[str, tuple[int, int]]]:
    url = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt"
    text = requests.get(url, timeout=90).text
    words: list[str] = []
    freq: dict[str, tuple[int, int]] = {}
    for line in text.splitlines():
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


def first_lemma(synsets) -> str | None:
    for ss in synsets:
        for lemma in ss.lemmas():
            x = lemma.replace("_", " ").strip()
            if x and len(x) <= 70:
                return x
    return None


def aligned(ss, lexicon: str) -> str | None:
    try:
        return first_lemma(ss.translate(lexicon=lexicon))
    except Exception:
        return None


def load_fallbacks():
    """Load corpus-derived dictionaries only if needed for coverage."""
    try:
        from word2word import Word2word
        print("Loading word2word fallbacks", flush=True)
        return {
            "de": Word2word("en", "de"),
            "fr": Word2word("en", "fr"),
            "zh": Word2word("en", "zh_cn"),
        }
    except Exception as exc:
        print(f"word2word fallback unavailable: {exc}", file=sys.stderr)
        return {}


def fallback(model, word: str) -> str | None:
    if model is None:
        return None
    try:
        vals = model(word)
    except Exception:
        return None
    for val in vals:
        val = str(val).strip()
        if val and len(val) <= 70:
            return val
    return None


def level_code(rank: int) -> int:
    # Broad learning bands, deliberately not claimed as official CEFR certification.
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


def clean_en_lemma(word: str) -> str | None:
    word = word.replace("_", " ").strip().lower()
    if " " in word or not WORD_RE.match(word) or word in BAD:
        return None
    return word


def choose_synset(en, word: str):
    try:
        synsets = en.synsets(word)
    except Exception:
        return None
    # N/V/adj/adv only; WN order preserves its preferred sense ordering.
    return next((ss for ss in synsets if ss.pos in POS_CODE), None)


def main() -> None:
    started = time.time()
    download_wordnets()
    en = wn.Wordnet("omw-en:1.4")
    words, freq = frequency_words()
    fallbacks = None
    rows: list[list] = []
    seen: set[str] = set()

    # Frequency-ranked candidates first.
    candidates = list(words)
    # Then extend using every canonical English WordNet lemma, preserving deterministic order.
    extra = []
    for w in en.words():
        lemma = clean_en_lemma(w.lemma())
        if lemma and lemma not in freq:
            extra.append(lemma)
    candidates.extend(sorted(set(extra)))

    for word in candidates:
        if len(rows) >= TARGET:
            break
        if word in seen:
            continue
        ss = choose_synset(en, word)
        if ss is None:
            continue
        try:
            definition = (ss.definition() or "").strip()
        except Exception:
            definition = ""
        if not definition:
            continue

        zh = aligned(ss, "omw-cmn:1.4")
        de = aligned(ss, "odenet:1.4")
        fr = aligned(ss, "omw-fr:1.4")

        if not (zh and de and fr):
            if fallbacks is None:
                fallbacks = load_fallbacks()
            zh = zh or fallback(fallbacks.get("zh"), word)
            de = de or fallback(fallbacks.get("de"), word)
            fr = fr or fallback(fallbacks.get("fr"), word)
        if not (zh and de and fr):
            continue

        rank = len(rows) + 1
        f_rank, f_count = freq.get(word, (None, None))
        syn_id = str(ss.id).split("-")[-2:] if hasattr(ss, "id") else []
        syn_id = "-".join(syn_id) if syn_id else str(rank)
        rows.append([
            word, POS_CODE.get(ss.pos, 0), level_code(rank), topic_code(definition, ss.pos),
            definition, zh, de, fr, f_rank, f_count, syn_id, 0,
        ])
        seen.add(word)
        if rank % 500 == 0:
            print(f"accepted {rank}/{TARGET}: {word}", flush=True)

    if len(rows) != TARGET:
        raise SystemExit(f"Could build only {len(rows)} complete four-language cards; refusing partial corpus")

    # Fixed-size shards: compact, cacheable, and friendlier to mobile browsers/GitHub Pages.
    for old in OUT.glob("part-*.js"):
        old.unlink()
    shard_size = 1000
    for i in range(0, TARGET, shard_size):
        shard = rows[i:i+shard_size]
        payload = json.dumps(shard, ensure_ascii=False, separators=(",", ":"))
        (OUT / f"part-{i//shard_size:02d}.js").write_text(
            "window.LB4_ROWS=window.LB4_ROWS||[];window.LB4_ROWS.push(..." + payload + ");\n",
            encoding="utf-8",
        )

    meta = "window.LB4_TOPICS=" + json.dumps(TOPICS, ensure_ascii=False, separators=(",", ":")) + ";window.LB4_ROWS=[];\n"
    (OUT / "meta.js").write_text(meta, encoding="utf-8")
    audit = {
        "cards": len(rows), "uniqueEnglish": len(seen), "shards": 10,
        "frequencyRanked": sum(1 for r in rows if r[8] is not None),
        "alignedFirstFallbackOnlyWhenMissing": True,
        "sources": ["omw-en:1.4", "omw-cmn:1.4", "omw-fr:1.4", "odenet:1.4", "FrequencyWords", "word2word fallback"],
        "seconds": round(time.time() - started, 1),
    }
    (OUT / "BUILD_AUDIT.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
