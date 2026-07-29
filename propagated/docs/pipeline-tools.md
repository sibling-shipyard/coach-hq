# Pipeline Tools — CLI Reference

Load this file on-demand when you need to run pipeline scripts. Do not read at boot.

---

## query_history.py

Searches local `user_data/activities/hist/*.json` files. No API calls — fast and safe.

```bash
python3 engine/core/query_history.py [filters] [output mode]
```

**Filters:**

| Flag | Description |
|------|-------------|
| `--sport SPORT` | Filter by sport type (e.g., Run, WeightTraining, Badminton) |
| `--from YYYY-MM-DD` | Start date filter |
| `--to YYYY-MM-DD` | End date filter |
| `--last Nd/Nw` | Relative window (e.g., `7d`, `2w`, `12w`) |
| `--peak-hr-above N` | Only activities where peak HR > N |
| `--avg-hr-above N` | Only activities where avg HR > N |
| `--has-photos` | Only activities with photos |
| `--has-description` | Only activities with a description |
| `--search TEXT` | Text search in title and description |
| `--id ID` | Single activity by ID |
| `--list-sports` | List all sport types with counts (no other output) |

**Output modes:**

| Flag | Description |
|------|-------------|
| *(default)* | Table view — one row per activity |
| `--summary` | Aggregate stats (count, total distance, avg HR) |
| `--detail` | Full JSON-style detail per activity |

**Mutation flags (require `--id`):**

| Flag | Description |
|------|-------------|
| `--add-notes "text"` | Append coach notes to the activity's local JSON |
| `--set-rpe N` | Set RPE (1-10) on the activity's local JSON |

**Common recipes:**

```bash
# What runs has the athlete done in the last 2 weeks?
python3 engine/core/query_history.py --sport Run --last 2w

# Full detail on last 3 months of activity
python3 engine/core/query_history.py --last 12w --detail

# Log RPE and notes after a session
python3 engine/core/query_history.py --id 12345678 --set-rpe 7 --add-notes "Knee held up. HR drifted high in final km — heat effect."

# What sport types are in the history?
python3 engine/core/query_history.py --list-sports

# Find a specific workout by name
python3 engine/core/query_history.py --search "Run #8"
```

Activities are named at ingestion time by the iOS app (see `ActivityNamer.swift`, which mirrors
`engine/core/rename_core.py`'s classification/naming rules). There's no separate rename script
anymore — if a name is genuinely wrong, edit the `name` field directly in the activity's JSON
under `user_data/activities/hist/`.

---

## generate_quest_log.py

Regenerates `gen/quest_log.md` from `user_data/ledger/challenge_v2.json` + `user_data/activities/hist/*.json`. Run this before every coach commit.

```bash
python3 engine/scripts/generate_quest_log.py [flags]
```

| Flag | Description |
|------|-------------|
| *(no flags)* | Regenerate and write `gen/quest_log.md` |
| `--dry-run` | Print output to stdout instead of writing the file |
| `--date YYYY-MM-DD` | Override today's date (for testing) |
| `--validate` | Validate `challenge_v2.json` schema and exit |

```bash
# Standard usage before commit
python3 engine/scripts/generate_quest_log.py

# Preview without writing
python3 engine/scripts/generate_quest_log.py --dry-run

# Validate the challenge JSON is well-formed
python3 engine/scripts/generate_quest_log.py --validate
```
