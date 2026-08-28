# 0002 — Wait to decide where the coach's "brain" lives

- **Status:** Superseded by 0022 · 2026-07-24 · Tech Lead
- **Outcome:** the deferral is spent. The brain lives at HQ and is bundled into
  coach-chat at build time (0021); BYO Claude Code survives as a second composed
  build with an end date (0022). Milestone M3 never had to arbitrate it.
- **Area:** cross-cutting
- **Context:** The coach's brain — its personality and rules — could live on our server, or
  be shipped into each user's repo and run on their own machine. Running it on our server is
  the only way to keep the brain private, but it's more work and we're not sure it's worth it
  yet.
- **Decision:** Don't decide yet. For now, ship the brain into each user's repo (they run it
  with their own Claude). Make the real call later, at milestone M3, once we've seen how the
  server version performs.
- **Why:** Committing now would lock in a choice we don't yet have enough information to make.
- **Rejected:** Go server-only now → too early, unproven. Commit to the ship-into-repo way
  forever → gives up the chance to keep the brain private later.
