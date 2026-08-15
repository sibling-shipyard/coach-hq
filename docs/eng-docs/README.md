# Engineering docs

> Status: Current · Owner: Tech Lead · Verified: 2026-08-15

Rules for HQ docs. Athletes never see these. **No index here — listings rot, which is why
`docs/CURRENT.md` was deleted. Never add one; use `ls` and `grep`.**

## Reference vs. plan

| Location | Holds | Lifecycle |
|---|---|---|
| `docs/eng-docs/` | Durable reference — how the system works today | Kept, re-verified |
| `docs/plans/` | In-flight work | **Deleted when shipped** — git history is the archive, there is no archive folder |
| `docs/ref-docs/` | Coach carve source | Ships to athlete repos on carve |

**Reference test — the rule that matters:** *if shipped code, a script, or an ADR cites a doc, it
is reference, not a plan.* `docs/plans/` is delete-on-ship, so filing a code-cited doc there
orphans those source comments. `coach-chat-closing-followup.md`, `coach-commit-mvp.md`, and
`user-3-onboarding-gate.md` all read like plans but are cited from `ui/api/coach-chat.ts`, its
tests, or other docs — so they stay here. Before deleting a shipped plan, fold anything durable
into its matching eng-doc.

**Carve rule:** if it ships to athlete repos under `propagated/docs/`, the source lives in
`docs/ref-docs/` (and `platform/skills/pipeline-tools.md`).

## Front matter

One blockquote line under the H1, no second header line:
`> Status: <Current|Historical|Superseded by <path>> · Owner: <role> · Verified: <YYYY-MM-DD>`

`Current` = the system as it is today. `Historical` = a dated record, never re-verified. Owner is
a role from the `AGENTS.md` routing table. **`Verified:` older than the code a doc describes is
the staleness signal.** Extra fields (`Authority:`, `ADR:`, `Carve:`) get appended, never
replaced — scripts and other docs cite them.

**Naming, new docs only:** `<chat|ios|soul|data|platform|ops>-<topic>.md`. Existing files are not renamed.
