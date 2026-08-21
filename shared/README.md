# shared/ — content shared across runtimes

Not code shared between HQ and athlete repos (that's `platform/`/`engine/`) — this is data and
design tokens shared between the web dashboard and iOS, so both render from the same source
instead of drifting.

| Path | Role |
|---|---|
| `golden-dataset/` | The fake athlete used for HQ's own dashboard/demo — see its own [README](golden-dataset/README.md) |
| `workout-library/` | Shared workout template definitions — see its own [README](workout-library/README.md) |
| `warm-instrument/` | Design tokens (`tokens.json`) for the Warm Instrument Home widgets, plus `ios-token-mapping.md` mapping them to SwiftUI |
