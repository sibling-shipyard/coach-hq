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

    private var entries: [SyncCacheEntry] {
        visible.map { $0.ledgerEntry(from: resolved($0)) }
    }

    private var listedLoads: [String: Int] {
        Dictionary(uniqueKeysWithValues: zip(visible, entries).compactMap { session, entry in
            session.load.map { (entry.id, Int($0.rounded())) }
        })
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
        if let source = session.evidence?.source,
           let hit = cache.first(where: { $0.fileName == source }) {
            return hit
        }
        if let dateKey = session.evidence?.dateKey,
           let hit = cache.first(where: { $0.fileName.hasPrefix(dateKey) || $0.startDateLocal.hasPrefix(dateKey) }) {
            return hit
        }
        return nil
    }
}

private extension RecentSessionSnapshot {
    func ledgerEntry(from cache: SyncCacheEntry?) -> SyncCacheEntry {
        if let cache { return cache }
        let dateKey = evidence?.dateKey
        return SyncCacheEntry(
            fileName: evidence?.source ?? "home:\(id)",
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
        if let dateKey = evidence?.dateKey,
           entry.fileName.hasPrefix(dateKey) || entry.startDateLocal.hasPrefix(dateKey) {
            return true
        }
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
