# Scripts — HQ operator utilities

Platform ops (compose, carve, provision) moved to [`platform/`](../platform/README.md).

## This folder

| Script | Role |
|---|---|
| `kdb/` | ADR index + validate-kdb (pre-commit) |
| `validate-current-week` | Wrapper → `engine/scripts/validate-current-week` |
| `generate_analytics_snapshot.py` | Badminton analytics wrapper — athlete repos only (HQ has no `user_data/`) |

## Sync model (user repos)

iOS commits `hk_*.json` to `user_data/activities/hist/`; Actions regenerates `gen/*` on push.
