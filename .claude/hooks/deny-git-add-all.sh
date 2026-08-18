#!/bin/bash
set -euo pipefail

# PreToolUse(Bash) guard: refuse commands that stage the whole worktree.
#
# WHY THIS EXISTS
# A subagent once ran `git add -A` and swept a node_modules symlink — one that
# embedded an absolute path to the athlete's machine — into a commit. The
# .gitignore rule that should have caught it only matched directories, so the
# symlink sailed past it. The fix at the time was a sentence in a role doc:
# "stage explicit paths". Subagents don't open role docs. A hook does the same
# job for free, forever, for every agent in the repo — Coach, Tech Lead, and
# every worker — without anyone having to have read anything.
#
# WHICH WAY IS FAIL-SAFE
# This hook sits in front of EVERY Bash call. If it denied on error it would
# brick the whole session, so an unreadable payload (bad JSON, missing
# tool_input.command, wrong tool) PERMITS and lets normal permissions apply.
# That is only safe because "unreadable" never overlaps with "dangerous": the
# parser below never needs the payload to be well-formed *shell* to make a
# decision. If shlex can't tokenise a segment we fall back to a plain
# whitespace split rather than giving up, so a real `git add -A` hidden in a
# command with unbalanced quotes is still caught. We permit only when there is
# genuinely no command string to inspect.
#
# WHAT IT DENIES
# Anything that stages everything: `git add -A`, `git add .`, `git add --all`,
# `git add --no-ignore-removal`, clustered short flags containing A (`-Av`),
# and all of the above nested inside compound commands, subshells, or command
# substitution. Explicit paths are always fine — including paths that merely
# contain a dot (`git add ./foo.sh`, `git add foo.md`) — as are `-p`, `-u`,
# and every non-`git add` command.
#
# WHAT IT DELIBERATELY DOES NOT DENY
# Heredoc bodies. `cat > doc.md <<'EOF' ... EOF` writes a file; it stages
# nothing. Without this carve-out the hook denies the very work that documents
# it — editing a role doc that quotes the forbidden command, or writing this
# hook's own tests. A heredoc opened on a line that invokes a shell (`bash <<`,
# `eval`, `xargs`) is still scanned, because that body really does execute.

INPUT="$(cat)"

python3 - "$INPUT" <<'PY'
import json
import os
import re
import shlex
import sys

PERMIT = 0  # emit nothing: the normal permission flow still applies


def permit():
    sys.exit(PERMIT)


def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


try:
    payload = json.loads(sys.argv[1])
except Exception:
    permit()

if not isinstance(payload, dict):
    permit()

if payload.get("tool_name") not in (None, "Bash"):
    permit()

tool_input = payload.get("tool_input")
if not isinstance(tool_input, dict):
    permit()

command = tool_input.get("command")
if not isinstance(command, str) or not command.strip():
    permit()

# Split on everything that can start a new command: operators, subshells,
# command substitution. Splitting too eagerly is safe here — it can only ever
# expose more `git add` invocations, never hide one.
SEPARATORS = re.compile(r"\$\(|&&|\|\||;|\||\n|`|\(|\)|\{|\}")

# `git add` spellings that stage the entire worktree.
STAGE_ALL = {"-A", "--all", "--no-ignore-removal", ".", "./"}

ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")

REASON = (
    "Blocked: this stages the whole worktree. A past agent ran `git add -A` here and "
    "swept a node_modules symlink holding an absolute machine path into a commit, past a "
    ".gitignore rule that only matched directories. Stage explicit paths instead, e.g. "
    "`git add path/one path/two`. `git add -p` and `git add -u <path>` are fine."
)


HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")
SHELL_RE = re.compile(r"\b(bash|sh|zsh|dash|ksh|eval|xargs)\b")


def strip_heredocs(cmd):
    """Drop heredoc bodies before scanning.

    A heredoc body is data, not a command: `cat > f <<'EOF' ... EOF` writes a file, it
    does not stage anything. Scanning bodies denies exactly the work that documents this
    rule -- editing a role doc that quotes the forbidden command, or writing a test for
    this hook. Bodies piped into a shell interpreter are KEPT, because those really do
    execute; that is what the SHELL_RE check on the opening line is for.
    """
    lines = cmd.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = HEREDOC_RE.search(line)
        if m and not SHELL_RE.search(line.split("<<")[0]):
            delim = m.group(2)
            i += 1
            while i < len(lines) and lines[i].strip() != delim:
                i += 1
        i += 1
    return "\n".join(out)


def tokenize(segment):
    try:
        return shlex.split(segment)
    except ValueError:
        # Unbalanced quotes: fall back rather than give up, so a real
        # `git add -A` in a malformed command is still seen.
        return segment.split()


def stages_everything(tokens):
    """tokens is one shell command; True if it is a stage-the-world `git add`."""
    while tokens and ASSIGNMENT.match(tokens[0]):
        tokens = tokens[1:]
    if not tokens:
        return False
    if os.path.basename(tokens[0]) != "git":
        return False

    # Walk past git's own global options to find the subcommand.
    rest = tokens[1:]
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok in ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"):
            i += 2
            continue
        if tok.startswith("-"):
            i += 1
            continue
        break
    if i >= len(rest) or rest[i] != "add":
        return False

    for arg in rest[i + 1:]:
        if arg in STAGE_ALL:
            return True
        # Clustered short flags: -Av, -vA, -nA ...
        if len(arg) > 1 and arg[0] == "-" and arg[1] != "-" and "A" in arg[1:]:
            return True
    return False


for segment in SEPARATORS.split(strip_heredocs(command)):
    if not segment.strip():
        continue
    if stages_everything(tokenize(segment)):
        deny(REASON)

permit()
PY
