# iOS widget modules — W2/W3 LLD

> Status: Current · Owner: iOS Builder · Verified: 2026-09-08

Execution detail for W2 and W3 in [`ios-widget-modules.md`](ios-widget-modules.md). That doc holds
the *why*; this one is what actually varies, the scale call, and the pbxproj mechanics — read
before starting either PR.

## 0. Correction to the plan's file count

The plan's W2 row lists six "forked" widgets: Engine, Quest, BuildPhase, Vo2, TrainingActivity,
Commitment. Only **four are actually forked** (a live Home copy *and* a live WidgetKit copy):
Engine, Quest, BuildPhase, Commitment. `Vo2Widget` and `TrainingActivityWidget` were Home
`private struct`s that nothing in `widgetColumn(for:)` ever instantiated — confirmed by
repo-wide grep before deleting them in W1 (`ios: delete Home's dead TrainingActivityWidget and
Vo2Widget structs`). Only `CoachHQWidget/`'s versions are live, wired from
`CoachHQWidgetBundle.swift`. There is no fork to reconcile for those two — W2/W3 do not touch
`CoachHQWidget/Vo2Widget.swift` or `CoachHQWidget/TrainingActivityWidget.swift` at all.

## 1. The scale decision

`EngineSnapshot` (M/L sizes) carries pipeline-computed `scaleLow`/`scaleHigh` (non-optional).
`EngineDetailGauge` reads them. Home's `EngineWidget.bandStrip` and
`CoachHQWidget/EngineWidget.swift`'s `bandStrip` both **shadow those two names** with a local
per-call derivation (`scaleLow = min(low, load) * 0.85`, etc.) and never read the snapshot
fields. `EngineDetailView` and Home's `.m`-size Engine card render the **same** `EngineSnapshot`
object (`snapshots.sizes.engine.M`, `WarmInstrumentHomeView.swift:82` and `:149`) — same week,
same load, same band — so the two renderers disagree only because one honors the pipeline scale
and the other recomputes its own.

**Decision: adopt `engine.scaleLow`/`engine.scaleHigh` in `bandStrip` for the M/L sizes, on both
Home and WidgetKit. Keep local derivation for S.** `EngineSnapshotS` (the WidgetKit-small /
Home-`.s` shape) has no scale fields — extending its schema is a pipeline/shared-dataset change
outside `ios/`'s scope, tracked as the P2 below rather than done here.

**Visible effect:** the Home `.m`/`.l` Engine card's load marker moves to match
`EngineDetailView`'s gauge, for the same week. That is the bug getting fixed, not a regression —
call it out in the W3 PR body so it doesn't read as an unexplained visual diff.

## 2. What genuinely varies across the three Engine renderings

| | Home (`.s`/`.m`/`.l`) | WidgetKit (`.systemSmall/Medium/Large`) | `EngineDetailView` |
|---|---|---|---|
| Scale source | pipeline (M/L), local (S) — same as WidgetKit | pipeline (M/L), local (S) | pipeline (only rendering already correct) |
| Entrance animation | `bandProgress` spring-in on appear/change | none (WidgetKit has no view lifecycle for this) | none (static once pushed) |
| Background | `WarmCard` (opaque card, in scroll column) | `.containerBackground(for: .widget)` (system-mandated) | full-bleed `RoundedRectangle` hero card |
| Placeholder state | none (real data or skeleton, one level up) | `.redacted(reason: .placeholder)` for gallery preview | none |
| Sizes (fonts/padding/heights) | per-size constants, own scale | per-family constants, own scale | detail-only constants |

**Consequence for W3:** `bandStrip`, `trendSparkline`, and `mixBar` become one set of pure
functions of primitive values (load/band/scale doubles, point/mix arrays) — no `@State`, no
`containerBackground`, no card chrome — callable from both a Home card body and a WidgetKit
`View`. Each surface's own wrapper still owns its chrome, animation, and background. This is the
plan's own P2 note under Deferred ("one View across all three surfaces is not the target") —
shared maths, thin per-surface wrapper, not literal view unification.

## 3. pbxproj mechanics

`CoachHQ.xcodeproj` uses `PBXFileSystemSynchronizedRootGroup` (folder sync), not per-file
`PBXBuildFile` entries (confirmed in W1 — zero pbxproj edits were needed to delete 4 files).

- The `CoachHQ` root group (`330C048E...`) auto-syncs its whole folder into the **CoachHQ** app
  target. `Views/Widgets/*.swift` (new) becomes a CoachHQ-target member automatically — no edit.
- The **CoachHQWidgetExtension** target does *not* own that folder, so it only sees files listed
  in `33FBADEA3014ACED00439B25` ("Exceptions for CoachHQ folder in CoachHQWidgetExtension
  target"). That `membershipExceptions` array is an **inclusion list** for this target (it is an
  *exclusion* list only in the exception set that names the folder's owning target,
  `330C04E1...`/CoachHQ). Forgetting an entry here fails silently in Xcode's UI but **not** in
  CI: `xcodebuild -scheme CoachHQ` builds the app and the embedded widget extension in one
  invocation, so a missing symbol in that target still fails the build.
- **W2 adds these paths** to that same exceptions array: `Views/Widgets/WidgetSize.swift`,
  `Views/Widgets/EngineCard.swift`, `Views/Widgets/CommitmentCard.swift`,
  `Views/Widgets/QuestCard.swift`, `Views/Widgets/BuildPhaseCard.swift`.
- `enum WidgetSize` (today `WarmInstrumentHomeView.swift:373`, app-only) moves to
  `Views/Widgets/WidgetSize.swift` because the four card files reference it and now compile into
  both targets — it has to resolve in both. Nothing in `CoachHQWidget/` uses it yet (W2 doesn't
  wire it up there); W3 decides whether WidgetKit ever needs it once `bandStrip` etc. are shared.
- Every other symbol the four cards touch (`WarmCard`, `SportCube`, `SportStripCell`,
  `MonoLabel`, `HairlineProgress`, `EngineSizes`, `TrendPointSnapshot`, `LoadMixSnapshot`,
  `CommitmentSizes`, `QuestSnapshot`/`QuestSnapshotS`, `BuildPhaseSnapshot`,
  `PhaseMilestoneSnapshot`, `WarmInstrument`) is already in `WarmInstrumentAtoms.swift` or
  `Models/WidgetSnapshots.swift`, both already on the CoachHQWidgetExtension exceptions list — no
  further pbxproj change needed for W2.

## 4. Naming

`…Widget` collides today — Home's `private struct EngineWidget: View` and
`CoachHQWidget/EngineWidget.swift`'s `struct EngineWidget: Widget` (the WidgetKit entry point)
only coexist because they compile into separate targets. Once Home's copy is a member of both
targets, the names must not collide. **In-app card views become `…Card`; `…Widget` is reserved
for the WidgetKit `Widget` conformer.** Matches web's own convention already shipped
(`EngineCard`, `QuestCard`, `TrainingActivityCard`, `SportCommitmentCard` —
`docs/plans/web-widget-modules.md`). Rename map for W2:

| Today (Home, `private struct`) | → |
|---|---|
| `EngineWidget` | `EngineCard` |
| `CommitmentStripWidget` | `CommitmentCard` |
| `QuestWidget` | `QuestCard` |
| `BuildPhaseWidget` | `BuildPhaseCard` |

Catalog keys (W6) are the server's strings, never invented here — unaffected by this rename.

## 5. W2 scope, precisely

Move the four structs above verbatim (body untouched, only the type name and file location
change) into `Views/Widgets/<Name>Card.swift`, update the four call sites in
`widgetColumn(for:)`, move `enum WidgetSize` into `Views/Widgets/WidgetSize.swift`, add the five
new paths to the pbxproj exceptions list. `RecentSessionsWidget`, `WeeklyPlanWidget`,
`CaloriesWidget`, `CoachMessageCard`, `CoachReadWidget`, `SportChip`, `EngineDetailView` /
`EngineDetailGauge` are **not** touched — those are W3b/W3's job. No hardcoded-colour or
formatter cleanup here (`BuildPhaseCard` keeps its two `Color(red:...)` literals) — that's W4.

**Done when (W2):** `xcodebuild test` green (app + widget extension both compile, so the pbxproj
inclusion is provably correct); before/after screenshots of Home match — this PR changes no
pixels.
