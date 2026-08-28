# 0033 — Coach chat threads are active or deleted, with no archive tier

- **Status:** Accepted · 2026-08-02 · Tech Lead · recorded inside 0012 at the time, split out
  2026-08-28 because it reverses that ADR rather than narrowing it
- **Area:** cross-cutting
- **Context:** ADR 0012 gave threads three states — active, archived, deleted — and exempted
  soft-deleted threads from the 7-thread cap so a Restore action had something to restore. The
  coach-chat redesign found nobody wanted any of it. The athlete's instruction was direct: "no
  archive option anywhere."
- **Decision:** `ChatThreadStatus` is `active | deleted`. Deleting is one PATCH, immediate and
  permanent — no Restore, no second confirmation. Deleted threads are filtered out of the array
  on the same write, so the cap now applies to every thread in the file and the rule collapses to
  `threads.slice(0, 7)`.
- **Why:** The archive tier cost UI surface and server logic for a state nobody asked for, and
  its exemption was the only reason the cap needed a rule more complicated than a slice.
- **Rejected:** Keep archive and hide it in the UI → the server logic and the cap exemption stay,
  which is where the complexity actually lived · Keep Restore without archive → restoring needs
  somewhere to restore from.
- **Enforces:** A retention rule that needs an exemption is the wrong rule. Before adding a
  thread state, name who uses it — if the answer is a hypothetical user, it does not ship.
