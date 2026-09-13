import SwiftUI

// MARK: - Shared components

/// 5 small HR zone circles: filled at zone color if ≥8% time in that zone, else dimmed.
struct ZoneDots: View {
    let zones: [String: HRZoneEntry]?

    private var fractions: [Double] {
        let vals = HRZone.keys.map { zones?[$0]?.seconds ?? 0 }
        let total = vals.reduce(0, +)
        guard total > 0 else { return Array(repeating: 0, count: 5) }
        return vals.map { $0 / total }
    }

    var body: some View {
        HStack(spacing: 3) {
            ForEach(fractions.indices, id: \.self) { i in
                Circle()
                    .fill(Theme.hrZoneColors[i])
                    .frame(width: 6, height: 6)
                    .opacity(fractions[i] > 0.08 ? 1.0 : 0.18)
            }
        }
    }
}

// MARK: - Ledger row

struct ActivityRowViewModel: Identifiable {
    let id: String
    let sport: String
    let title: String
    let category: String?
    let hrZones: [String: HRZoneEntry]?
    let startDateLocal: String
    let elapsedTime: Int
    let calories: Int?
    let load: Int?
    let needsScores: Bool
}

extension SyncCacheEntry {
    var asRowViewModel: ActivityRowViewModel {
        ActivityRowViewModel(
            id: id,
            sport: sportType,
            title: name,
            category: activity?.category,
            hrZones: activity?.hrZones,
            startDateLocal: startDateLocal,
            elapsedTime: elapsedTime,
            calories: activity?.calories ?? calories,
            load: nil,
            needsScores: sportType == "Badminton" && !hasDescription
        )
    }
}

extension SyncedActivityRow {
    var asRowViewModel: ActivityRowViewModel {
        ActivityRowViewModel(
            id: id,
            sport: sport,
            title: title.isEmpty ? Theme.sportBadge(for: sport).label.capitalized : title,
            category: nil,
            hrZones: nil,
            startDateLocal: start,
            elapsedTime: durationSeconds,
            calories: nil,
            load: load,
            needsScores: false
        )
    }
}

/// Receipt-style row used in Coach Chat post-sync turns. All Activity uses
/// `ActivityLedgerView`; chat moves onto those cards in the follow-up PR.
struct ActivityLedgerRow: View {
    let vm: ActivityRowViewModel

    private var sportColor: Color { Theme.sportBadge(for: vm.sport).color }

    private var trailingText: String {
        if let load = vm.load { return "+\(load)" }
        if let cal = vm.calories { return "\(cal)" }
        return Format.duration(seconds: vm.elapsedTime)
    }

    private var trailingColor: Color {
        vm.load != nil ? WarmInstrument.accent : sportColor
    }

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(sportColor.opacity(0.12))
                    .frame(width: 28, height: 28)
                Image(systemName: Theme.sportIcon(for: vm.sport))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(sportColor)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(vm.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)

                subtitleRow
            }

            Spacer(minLength: 8)

            Text(trailingText)
                .font(WarmInstrument.figures(14, weight: .bold))
                .foregroundColor(trailingColor)
                .contentTransition(.numericText())
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var subtitleRow: some View {
        if vm.category != nil || vm.hrZones != nil || vm.needsScores {
            HStack(spacing: 6) {
                if let category = vm.category {
                    MonoLabel(category, size: 9, color: sportColor, tracking: 0.5)
                }
                if let zones = vm.hrZones {
                    ZoneDots(zones: zones)
                }
                if vm.needsScores {
                    Circle().fill(Theme.attentionOrange).frame(width: 5, height: 5)
                }
            }
        } else if !metaLine.isEmpty {
            Text(metaLine)
                .font(WarmInstrument.monoLabel(9.5))
                .foregroundStyle(WarmInstrument.inkFaint)
        }
    }

    private var metaLine: String {
        [Self.timeLabel(vm.startDateLocal), Format.duration(seconds: vm.elapsedTime)]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private static func timeLabel(_ start: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current
        guard let date = formatter.date(from: String(start.prefix(19))) else { return "" }
        let out = DateFormatter()
        out.dateFormat = "h:mm a"
        return out.string(from: date)
    }
}
