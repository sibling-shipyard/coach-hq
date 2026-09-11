import SwiftUI

/// S/M/L density picked per-widget in Home's edit mode. Shared with `CoachHQWidgetExtension`
/// because the card views in this directory compile into both targets — see
/// `docs/plans/ios-widget-modules-lld.md` §3.
enum WidgetSize: String {
    case s = "S", m = "M", l = "L"
}
