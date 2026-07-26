# 0006 — Prove the SOUL split with a line-by-line ledger, not a byte match

- **Status:** Accepted · 2026-07-26 · Tech Lead
- **Area:** core
- **Context:** We're splitting the coach's one big brain file (`SOUL.md` v5.7) into three parts — who the coach is (A), what it does (B), and the athlete's data (C). The split rewrites prose as it goes, so the new file can't be an exact copy of the old one. We still need proof that no rule was quietly lost.
- **Decision:** Freeze v5.7 as a read-only reference and account for **every line exactly once** in a ledger (`soul/disposition.yaml`), each line marked kept / moved / rewritten / dropped. Freeze the target file layout up front as a path contract (`soul/paths.contract.json`). CI fails if any line is unaccounted for, claimed twice, a target path is missing, or a rule points at a name that doesn't exist. The v5.7 source of truth stays in the `coach-phelps` repo; this HQ repo holds the split and its tooling.
- **Why:** A total line-by-line account can't miss a dropped rule the way an eyeball diff can, and it survives the prose rewrites that an exact-copy check cannot.
- **Rejected:** Byte-for-byte "golden file" match → impossible once prose is rewritten (verbs replace scripts, paths move, sport nouns go generic). Eyeball the 447-line diff by hand → misses silent drops, doesn't scale to future edits.
