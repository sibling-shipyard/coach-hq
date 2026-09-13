import SwiftUI

/// In-app recent-sessions list — one file per widget, per ADR 0037.
/// Same compact paper stack as Coach chat's SESSION SYNCED slot.
struct RecentSessionsCard: View {
    let sessions: [RecentSessionSnapshot]
    var onOpenActivities: (() -> Void)? = nil
    let onOpen: (SyncCacheEntry) -> Void
    let onUnavailable: () -> Void

    @State private var cacheEntries: [SyncCacheEntry] = []

    private var visible: [RecentSessionSnapshot] { Array(sessions.prefix(3)) }

    private var cache: [SyncCacheEntry] {
        cacheEntries.isEmpty ? SyncCache.load() : cacheEntries
    }

    private var pairs: [(RecentSessionSnapshot, SyncCacheEntry)] {
        var seen = Set<String>()
        return visible.compactMap { session in
            let entry = session.ledgerEntry(from: resolved(session))
            guard seen.insert(entry.id).inserted else { return nil }
            return (session, entry)
        }
    }

    private var entries: [SyncCacheEntry] { pairs.map(\.1) }

    private var listedLoads: [String: Int] {
        Dictionary(
            pairs.compactMap { session, entry in
                session.load.map { (entry.id, Int($0.rounded())) }
            },
            uniquingKeysWith: { first, _ in first }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                MonoLabel("RECENT")
                Spacer()
                if let onOpenActivities {
                    Button {
                        Haptics.tap()
                        onOpenActivities()
                    } label: {
                        Text("All activity")
                            .font(.system(size: 11.5, weight: .semibold))
                            .foregroundColor(WarmInstrument.ink)
                    }
                    .buttonStyle(.plain)
                }
            }

            if visible.isEmpty {
                Text("No sessions logged yet — nothing invented here.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .padding(.vertical, 8)
            } else {
                ActivityLedgerView(
                    entries: entries,
                    onSelect: { entry in
                        if let session = visible.first(where: { $0.matches(entry) }),
                           let hit = resolved(session) {
                            onOpen(hit)
                        } else {
                            onUnavailable()
                        }
                    },
                    style: .embed,
                    listedLoads: listedLoads
                )
            }
        }
        .onAppear {
            if cacheEntries.isEmpty {
                cacheEntries = SyncCache.load()
            }
        }
    }

    private func resolved(_ session: RecentSessionSnapshot) -> SyncCacheEntry? {
        guard let source = session.evidence?.source else { return nil }
        return cache.first(where: { $0.fileName == source })
    }
}

private extension RecentSessionSnapshot {
    func ledgerEntry(from cache: SyncCacheEntry?) -> SyncCacheEntry {
        if let cache { return cache }
        let dateKey = evidence?.dateKey
        return SyncCacheEntry(
            fileName: "home:\(id)",
            name: title,
            sportType: sport.ledgerSportType,
            startDateLocal: dateKey.map { "\($0)T12:00:00" } ?? "",
            elapsedTime: Int((evidence?.durationMinutes ?? 0) * 60),
            hasDescription: false,
            calories: evidence?.calories.map { Int($0.rounded()) },
            averageHeartrate: evidence?.averageHeartRate,
            maxHeartrate: evidence?.maxHeartRate,
            distance: evidence?.distanceKm.map { $0 * 1000 }
        )
    }

    func matches(_ entry: SyncCacheEntry) -> Bool {
        if let source = evidence?.source, entry.fileName == source { return true }
        return entry.fileName == "home:\(id)"
    }
}

private extension WarmSportId {
    /// HealthKit-shaped string so `ActivityLedgerItem` picks the same tick, glyph, and stat columns.
    var ledgerSportType: String {
        switch self {
        case .badminton: return "Badminton"
        case .cycling: return "Ride"
        case .run: return "Run"
        case .foundation, .strength, .weightTraining, .calisthenics, .workout: return "WeightTraining"
        default: return rawValue
        }
    }
}
