# Badminton plugin

> **NOT WIRED UP YET.** SOUL points at `propagated/docs/badminton-plugin.md`, but
> `carve-skeleton.mjs` writes no docs at all — ADR 0021 removed that step — so this file does not
> exist in any athlete repo today. Coach follows the pointer and finds nothing. Restoring it is
> phase 2 of `docs/eng-docs/soul-path-to-v6.md`; `validate-soul` carries the dangling reference as
> a known `rot` finding until then.
>
> Once carved: Coach reads this on demand, only when the plugin is enabled and match data is
> actually in play. SOUL keeps the gate and a pointer.

**Gate:** read `user_data/ledger/plugins.json`. If `"badminton"` is not in `enabled`, coach
badminton like any other sport — HR, duration, load, weekly plan only. Do not read the match
files below.

**When enabled**, scored sessions produce a formatted description on the activity (display layer)
and structured games in `user_data/activities/match_history.json` (analytics layer, ADR 0013). The
sync pipeline may also maintain `gen/badminton_analytics_snapshot.json` — pre-computed H2H,
win-rate, nemesis stats for match prep.

| Trigger | Read |
|---|---|
| Boot / weekly skim | **Do not** load snapshot or `match_history.json` at boot — use `query_history.py --last 7d` like other sports |
| Session debrief ("how did Monday go?") | `python3 engine/core/query_history.py --id ACTIVITY_ID --detail` — game lines appear in the description if the athlete pasted scores in iOS |
| Opponent named, H2H, win-rate, nemesis, match prep | `gen/badminton_analytics_snapshot.json` |
| Athlete-specific league / taxonomy context | `user_data/coach/reference/badminton.md` (if present) |

**Score entry (Format A only):** the athlete pastes `me vs Opponent 21-18` or
`{partner} me vs Opp1/Opp2 21-18` in the iOS app — you do not parse raw paste text; read the
formatted activity description or snapshot.

**Singles:** games with `format: "singles"` have no partner — do not attribute partner stats to
singles games.

**Categories:** session naming (`ActivityNamer.swift`) stays four-tier (ranked / league / friendly
/ casual) until the athlete approves a taxonomy change — do not collapse labels in conversation.

Match data exists only after the athlete pastes scores in iOS — never assume games from
HR/duration alone. (This one line stays in SOUL itself, in both builds — it is the guardrail that
matters even when the plugin is off.)
