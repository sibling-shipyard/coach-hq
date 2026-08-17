# Coach redesign review — Part 5: First Session Protocol changes

> Working doc for review, not a final eng-doc. Stub — fill in once parts 1-4 are annotated, since
> FSP is downstream of all of them plus Akash's SOUL changes.

## Why this is last

First Session Protocol is the one place that writes `profile.json` (and touches `memory.json`,
`sessions.json`) in full. Every field decision in parts 1-4 changes what FSP has to ask for,
validate, and write, and in what order. This doc exists to walk through that once the shape of
those files is settled, not before.

## To fill in once parts 1-4 are annotated

- What FSP asks the athlete for, mapped against the final `profile.json` fields (currently:
  `name`, `dob`, `timezone`, `coach_since` — pending part 1's other moves landing).
- What FSP writes to `memory.json` on completion (`sports`, `goal`, `timeline`, `coaching_style`
  per part 1's annotation, plus anything parts 2-4 add).
- How `isAthleteProfileComplete()` / `REQUIRED_PROFILE_FIELDS` (the #362 fix) maps onto the new
  file split — which fields actually gate "is this athlete onboarded," now that profile.json is
  much smaller.
- Any changes Akash made to SOUL's First Session Protocol section that this doc needs to reconcile
  against.

## Your annotations

(space for your changes)
