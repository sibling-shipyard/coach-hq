# Broken fixture repo
Deliberately violates several ERROR-level contracts. `validate-repo.py --repo .`
MUST fail (non-zero). Each defect below maps to a check; if the validator ever
passes this repo, a check has regressed.
Defects: state.md missing core sections; challenge_v2.json missing version &
last_updated_at, main_quest missing type, quest missing status; sleep_log.json
is an object not an array; a session missing required fields; a session with a
bad session_date; a session with invalid JSON.
