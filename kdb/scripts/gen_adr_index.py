#!/usr/bin/env python3
"""Regenerate the ADR index table in kdb/decisions/README.md from the ADR files.
The index lives between the ADR-INDEX markers so it can't drift by hand."""
import pathlib, re, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import adr_readability

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEC = ROOT / "kdb" / "decisions"
README = DEC / "README.md"
START = "<!-- ADR-INDEX:START"
END = "<!-- ADR-INDEX:END -->"
ADR_RE = re.compile(r"^(\d{4})-[a-z0-9-]+\.md$")

def parse(fp):
    num = fp.name[:4]
    text = fp.read_text()
    title, area = "", "?"
    for line in text.splitlines():
        if not title and line.startswith("# "):
            title = line[2:].strip()
            title = re.sub(r"^\d{4}\s*[—-]\s*", "", title)  # drop "NNNN — "
        m = re.match(r"-\s*\*\*Area:\*\*\s*(.+)", line)
        if m:
            area = m.group(1).strip()
    # An ADR that no longer binds anyone still has to exist — it is cited by number from
    # other ADRs, and the README's own rule is supersede, never delete. So it moves out of
    # the table agents skim on boot instead, which is the cost we actually wanted to cut.
    kind, target = adr_readability.status(text)
    return num, title, area, kind, target

def build_table():
    live, closed = [], []
    for fp in sorted(DEC.glob("[0-9][0-9][0-9][0-9]-*.md")):
        if fp.name == "0000-template.md" or not ADR_RE.match(fp.name):
            continue
        num, title, area, kind, target = parse(fp)
        if kind == "live":
            live.append(f"| {num} | {title} | {area} |")
        else:
            note = f"→ {target}" if target else "Historical"
            closed.append(f"| {num} | {title} | {note} |")

    if not live:
        body = "_(no ADRs yet)_"
    else:
        body = "| # | Title | Area |\n|---|---|---|\n" + "\n".join(live)

    if closed:
        body += (
            f"\n\n<details>\n<summary>Superseded / historical ({len(closed)}) — "
            "kept for the citations, not for the boot read</summary>\n\n"
            "| # | Title | Replaced by |\n|---|---|---|\n" + "\n".join(closed)
            + "\n\n</details>")
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
