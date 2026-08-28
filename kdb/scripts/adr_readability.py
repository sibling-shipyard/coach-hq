#!/usr/bin/env python3
"""Prose checks for ADRs: sentence length, field budgets, jargon, cold-read.

Imported by validate_kdb.py; also runnable standalone for the score table:

    python3 kdb/scripts/adr_readability.py

WHY A SCORE IS REPORTED BUT NEVER GATES
Flesch-Kincaid is a proxy, and a gameable one: chopping a clear sentence into
three fragments improves the grade while making the text worse. So FK prints as
a number to watch and nothing more. What gates is mechanical and can only be
satisfied by actually shortening a sentence or cutting a word.

WHY LENGTH IS NOT THE GATE EITHER
Measured across the 30 ADRs at the time this was written, word count and
readability were independent: 0025 (horcruxes) was the second-longest file and
the most readable in the set, while 0014 was in the shortest tier and scored
near the bottom, because it was passive and nominalized. A word cap alone
passes 0014 and fails 0025 — backwards. The field budgets below stay as a bloat
cap; the sentence-length rule is what tracks readability.
"""
import re

# Field budgets (words). WARN ONLY, and the reason is in this file's own history:
# when these were first written as hard errors, the check failed 0025 on all four
# fields — the most readable ADR in the set — while 0014, the least readable, passed
# every budget and tripped only on jargon. That is the exact inversion the module
# docstring warns about, reproduced by the check meant to prevent it. A budget can
# say "this got long", never "this reads badly", so it does not gate.
FIELD_BUDGET = {"Context": 80, "Decision": 80, "Why": 50, "Rejected": 80}

SENTENCE_FAIL_WORDS = 40
SENTENCE_WARN_WORDS = 30

# Cold-read: an ADR you cannot follow without opening two others is not readable,
# and no prose metric catches it. Counted in Context/Decision only — a Rejected or
# a Status note may legitimately cite the ADR that narrows it.
CROSS_REF_WARN = 2

# Wordiness and jargon, with the shorter word that replaces each. Precision over
# reach: every entry here is one a rewrite can act on mechanically.
#
# NOTE: AGENTS.md also greps chronology tells (`legacy`, `no longer`, `used to`,
# `existing`) in code comments. They are deliberately NOT banned here. In a
# comment, history is noise; in an ADR's Context, history is the point — 0008's
# "legacy Phelps build" is the fact the decision turns on.
JARGON = {
    r"\bdue to\b": "because",
    r"\bin order to\b": "to",
    r"\bprior to\b": "before",
    r"\bsubsequent to\b": "after",
    r"\bin the event that\b": "if",
    r"\bat this point in time\b": "now",
    r"\ba number of\b": "several",
    r"\bit should be noted that\b": "(cut it)",
    r"\butilize[ds]?\b": "use",
    r"\bfacilitates?\b": "helps",
    r"\bleverages?\b": "use",
    r"\bsurface area\b": "say what actually grows",
    r"\baffordances?\b": "say what it lets you do",
}
JARGON_RE = [(re.compile(p, re.I), fix) for p, fix in JARGON.items()]

FENCE_RE = re.compile(r"```.*?```", re.S)
COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
TABLE_RE = re.compile(r"^\s*\|.*$", re.M)
META_RE = re.compile(r"^\s*-?\s*\*\*(?:Status|Area):\*\*.*$", re.M)
HEADING_RE = re.compile(r"^#.*$", re.M)
LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
CODE_SPAN_RE = re.compile(r"`[^`\n]*`")
ADR_REF_RE = re.compile(r"\bADR[- ]?\d{4}\b|\b\d{4}-[a-z0-9-]+\.md\b|\[\s*0\d{3}\s*\]")

# `e.g.` and friends end in a period and must not split a sentence.
ABBREV_RE = re.compile(r"\b(?:e\.g|i\.e|etc|vs|approx|Dr|Mr|Ms|No)\.", re.I)
_ABBREV_HOLD = "\x00"


def strip_markup(text):
    """Drop everything that is not prose we are judging.

    Code spans collapse to a single token: a backticked path is one idea to a
    reader but six syllables and four words to a naive scorer, and letting it
    count would penalise exactly the citations the house style asks for.
    """
    text = COMMENT_RE.sub(" ", text)
    text = FENCE_RE.sub(" ", text)
    text = TABLE_RE.sub(" ", text)
    text = META_RE.sub(" ", text)
    text = HEADING_RE.sub(" ", text)
    text = LINK_RE.sub(r"\1", text)
    text = CODE_SPAN_RE.sub(" CODE ", text)
    text = re.sub(r"\*\*|\*|~~", "", text)
    text = re.sub(r"^\s*[-·]\s+", "", text, flags=re.M)
    return text


def sentences(text):
    """Split prose into sentences, protecting abbreviations and `·` separators."""
    text = ABBREV_RE.sub(lambda m: m.group(0).replace(".", _ABBREV_HOLD), text)
    parts = re.split(r"(?<=[.!?])\s+|\s+·\s+|\n{2,}", text)
    out = []
    for p in parts:
        p = p.replace(_ABBREV_HOLD, ".").strip()
        if len(p.split()) > 2:
            out.append(p)
    return out


def _syllables(word):
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    n, prev_vowel = 0, False
    for c in w:
        is_vowel = c in "aeiouy"
        if is_vowel and not prev_vowel:
            n += 1
        prev_vowel = is_vowel
    if w.endswith("e") and n > 1:
        n -= 1
    return max(n, 1)


def score(text):
    """Readability numbers for one ADR body. Reported, never gated."""
    sents = sentences(strip_markup(text))
    if not sents:
        return None
    words = [w for s in sents for w in s.split()]
    n_words, n_sents = len(words), len(sents)
    syl = sum(_syllables(w) for w in words)
    fk = 0.39 * (n_words / n_sents) + 11.8 * (syl / n_words) - 15.59
    return {
        "fk": round(fk, 1),
        "words": n_words,
        "sentences": n_sents,
        "avg_sentence": round(n_words / n_sents, 1),
        "max_sentence": max(len(s.split()) for s in sents),
        "over_warn": sum(1 for s in sents if len(s.split()) > SENTENCE_WARN_WORDS),
    }


def fields(text):
    """Map field name -> its prose, for `- **Name:** body` blocks."""
    out, current, buf = {}, None, []
    for line in text.splitlines():
        m = re.match(r"^\s*-?\s*\*\*([A-Za-z ]+):\*\*(.*)$", line)
        if m:
            if current:
                out[current] = "\n".join(buf).strip()
            current, buf = m.group(1).strip(), [m.group(2)]
        elif current is not None:
            if re.match(r"^#", line):
                out[current] = "\n".join(buf).strip()
                current, buf = None, []
            else:
                buf.append(line)
    if current:
        out[current] = "\n".join(buf).strip()
    return out


def _excerpt(sentence, width=70):
    """One-line quote of a sentence. Source newlines are collapsed: findings are read
    in a scrolling build log where an embedded newline breaks the one-finding-per-line
    scan the whole report depends on."""
    flat = " ".join(sentence.split())
    return flat if len(flat) <= width else flat[:width] + "..."


def findings(name, text):
    """[(severity, message)] for one ADR. severity is 'error' or 'warn'."""
    out = []
    body = strip_markup(text)

    for s in sentences(body):
        n = len(s.split())
        if n > SENTENCE_FAIL_WORDS:
            out.append(("error", f"{name}: {n}-word sentence (max {SENTENCE_FAIL_WORDS}) — "
                                 f"split it: \"{_excerpt(s)}\""))
        elif n > SENTENCE_WARN_WORDS:
            out.append(("warn", f"{name}: {n}-word sentence (>{SENTENCE_WARN_WORDS}) — "
                                f"\"{_excerpt(s)}\""))

    parsed = fields(text)
    for field, budget in FIELD_BUDGET.items():
        if field not in parsed:
            continue
        n = len(strip_markup(parsed[field]).split())
        if n > budget:
            out.append(("warn", f"{name}: {field} is {n} words (budget {budget}) — "
                                "long is not the same as unreadable; cut only if it is both"))

    for rx, fix in JARGON_RE:
        m = rx.search(body)
        if m:
            out.append(("error", f"{name}: \"{m.group(0)}\" — say \"{fix}\""))

    head = " ".join(strip_markup(parsed.get(f, "")) for f in ("Context", "Decision"))
    refs = {r.lower() for r in ADR_REF_RE.findall(head)}
    if len(refs) >= CROSS_REF_WARN:
        out.append(("warn", f"{name}: Context/Decision leans on {len(refs)} other ADRs — "
                            "a reader should not need to open two more files"))
    return out


if __name__ == "__main__":
    import pathlib
    here = pathlib.Path(__file__).resolve().parents[2] / "kdb" / "decisions"
    rows = []
    for fp in sorted(here.glob("0*.md")):
        if fp.name == "0000-template.md":
            continue
        s = score(fp.read_text())
        if s:
            rows.append((s, fp.name))
    print(f"{'FK':>5} {'avg':>5} {'max':>4} {'>30w':>5} {'words':>6}  file")
    for s, n in sorted(rows, key=lambda r: r[0]["fk"]):
        print(f"{s['fk']:5.1f} {s['avg_sentence']:5.1f} {s['max_sentence']:4d} "
              f"{s['over_warn']:5d} {s['words']:6d}  {n}")
