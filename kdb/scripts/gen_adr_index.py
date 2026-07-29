#!/usr/bin/env python3
"""Regenerate the ADR index table in kdb/decisions/README.md from the ADR files.
The index lives between the ADR-INDEX markers so it can't drift by hand."""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEC = ROOT / "kdb" / "decisions"
README = DEC / "README.md"
START = "<!-- ADR-INDEX:START"
END = "<!-- ADR-INDEX:END -->"
ADR_RE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")

def parse(fp):
    num = fp.name[:4]
    title, area = "", "?"
    for line in fp.read_text().splitlines():
        if not title and line.startswith("# "):
            title = line[2:].strip()
            title = re.sub(r"^\d{4}\s*[—-]\s*", "", title)  # drop "NNNN — "
        m = re.match(r"-\s*\*\*Area:\*\*\s*(.+)", line)
        if m:
            area = m.group(1).strip()
    return num, title, area

def build_table():
    rows = []
    for fp in sorted(DEC.glob("[0-9][0-9][0-9][0-9]-*.md")):
        if fp.name == "0000-template.md" or not ADR_RE.match(fp.name):
            continue
        num, title, area = parse(fp)
        rows.append(f"| {num} | {title} | {area} |")
    body = "| # | Title | Area |\n|---|---|---|\n" + "\n".join(rows) if rows else "_(no ADRs yet)_"
    return body

def main():
    text = README.read_text()
    lines = text.splitlines()
    s = next(i for i, l in enumerate(lines) if l.startswith(START))
    e = next(i for i, l in enumerate(lines) if l.startswith(END))
    new = lines[:s+1] + build_table().splitlines() + lines[e:]
    out = "\n".join(new) + "\n"
    if out != text:
        README.write_text(out)
        print("index regenerated")
    else:
        print("index already up to date")

if __name__ == "__main__":
    main()
