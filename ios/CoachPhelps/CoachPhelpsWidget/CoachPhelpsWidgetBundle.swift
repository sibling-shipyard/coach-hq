import WidgetKit
import SwiftUI

/// Phase 3 — iOS home-screen widgets. Glance-only per the Design Philosophy's "iOS home
/// screen widgets" platform row: zero interaction required, native long-press editor, never a
/// placeholder number shown as real. Engine/Quest/Commitment now support S/M(/L); Training
/// Activity, Build Phase, and VO2 Max are new S/M additions. Calories is intentionally excluded
/// until issue #68 lands upstream (see `patches/PATCHES.md`).
@main
struct CoachPhelpsWidgetBundle: WidgetBundle {
    var body: some Widget {
        EngineWidget()
        QuestWidget()
        CommitmentWidget()
        TrainingActivityWidget()
        BuildPhaseWidget()
        Vo2Widget()
    }
}
