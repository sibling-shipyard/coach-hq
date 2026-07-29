import SwiftUI

/// Compact mobile home header — `HQ` wordmark and build-phase badge. Matches the
/// `wi-instrument-header` mobile row in `Warm Instrument Mobile.dc.html` / web `@media (max-width: 720px)`.
struct CompactInstrumentHeader: View {
    let phase: BuildPhaseSnapshot

    var body: some View {
        HStack(spacing: 10) {
            Text("HQ")
                .font(WarmInstrument.monoLabel(12))
                .tracking(1.4)
                .foregroundColor(WarmInstrument.ink)

            Text("BUILD · \(phase.weekLabel.uppercased())")
                .font(WarmInstrument.monoLabel(9))
                .tracking(1.0)
                .foregroundColor(WarmInstrument.paper)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(WarmInstrument.accent)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.top, 2)
        .padding(.bottom, 4)
    }
}

/// The slim instrument strip under the "Home" tab bar title — phase label, sync pill, and
/// snapshot staleness. Mirrors the intent of the web `InstrumentHeader.tsx` phase label + sync
/// pill for the "iOS app (Home)" surface, without the nav menu (that's the tab bar's job here).
struct InstrumentHeaderView: View {
    let phase: BuildPhaseSnapshot
    let sync: WidgetSyncSnapshot
    let generatedAt: String

    private struct Staleness {
        let label: String
        let isStale: Bool
    }

    private var staleness: Staleness {
        guard let date = ISO8601DateFormatter().date(from: generatedAt) else {
            return Staleness(label: "Updated —", isStale: false)
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        let label = "Updated " + formatter.localizedString(for: date, relativeTo: Date())
        let isStale = -date.timeIntervalSinceNow > 24 * 3600
        return Staleness(label: label, isStale: isStale)
    }

    var body: some View {
        let staleness = self.staleness

        HStack(spacing: 10) {
            HStack(spacing: 6) {
                MonoLabel(phase.title ?? "BUILD PHASE", size: 9)
                Text(phase.weekLabel)
                    .font(WarmInstrument.figures(11, weight: .bold))
                    .foregroundColor(WarmInstrument.ink)
            }

            Spacer(minLength: 8)

            Text(staleness.label)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundColor(staleness.isStale ? WarmInstrument.alarmFg : WarmInstrument.inkFaint)
                .lineLimit(1)

            syncPill
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(WarmInstrument.desk)
    }

    private var syncPill: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(sync.healthy ? WarmInstrument.inkFaint : WarmInstrument.alarmFg)
                .frame(width: 6, height: 6)
            Text(sync.label)
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(sync.healthy ? WarmInstrument.inkMuted : WarmInstrument.alarmFg)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(sync.healthy ? Color.clear : WarmInstrument.alarmBg)
        .clipShape(Capsule())
    }
}

#Preview("Compact instrument header — golden dataset") {
    CompactInstrumentHeader(phase: GoldenDataset.phase)
        .padding()
        .background(WarmInstrument.desk)
}

#Preview("Instrument header — golden dataset") {
    InstrumentHeaderView(
        phase: GoldenDataset.phase,
        sync: GoldenDataset.sync,
        generatedAt: GoldenDataset.snapshots.generatedAt
    )
    .padding()
    .background(WarmInstrument.desk)
}
