import WidgetKit
import SwiftUI

/// Phase 3 — iOS home-screen widgets. Glance-only S variants per the Design Philosophy's
/// "iOS home screen widgets" platform row: zero interaction required, native long-press
/// editor, never a placeholder number shown as real. Engine, Quest, and a single Commitment
/// cube are first; calories is intentionally excluded until issue #68 lands upstream (see
/// `patches/PATCHES.md`).
@main
struct CoachPhelpsWidgetBundle: WidgetBundle {
    var body: some Widget {
        EngineWidget()
        QuestWidget()
        CommitmentWidget()
    }
}
