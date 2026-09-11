import Foundation

/// One row of "vs your usual" comparison data. Pure — no SwiftUI — so `UsualComparisonRow`
/// (`ActivityDetailView.swift`) only has to render it, never compute it.
struct UsualRow {
    let label: String
    let currentValue: Double
    let usualValue: Double
    let minVal: Double
    let maxVal: Double
    let deltaLabel: String
}

/// Builds "vs your usual" rows two ways, same shape as `RibbonBuilder`: pure and free of
/// SwiftUI so the median/percent-delta arithmetic can be tested directly, without constructing
/// a whole `ActivityDetailView`.
enum UsualRowBuilder {
    /// A stored block is one coherent historical snapshot, server-computed (`Activity.vsUsual`).
    /// Missing metrics stay missing rather than being filled from the shorter on-device cache.
    static func storedRows(
        from stored: VsUsual,
        currentElapsedTime: Int,
        currentAverageHeartrate: Double?,
        currentHRZones: [String: HRZoneEntry]?
    ) -> [UsualRow] {
        var rows: [UsualRow] = []
        let currentDuration = Double(currentElapsedTime)

        if let usual = stored.durationMedianS, usual > 0 {
            let pct = ((currentDuration - usual) / usual * 100).rounded()
            let sign = pct >= 0 ? "+" : ""
            rows.append(UsualRow(
                label: "Duration",
                currentValue: currentDuration,
                usualValue: usual,
                minVal: 0,
                maxVal: max(currentDuration, usual) * 1.2,
                deltaLabel: "\(sign)\(Int(pct))%"
            ))
        }

        if let usual = stored.avgHRMedian,
           let currentHR = currentAverageHeartrate {
            let diff = currentHR - usual
            let sign = diff >= 0 ? "+" : ""
            rows.append(UsualRow(
                label: "Avg HR",
                currentValue: currentHR,
                usualValue: usual,
                minVal: min(currentHR, usual) * 0.92,
                maxVal: max(currentHR, usual) * 1.08,
                deltaLabel: "\(sign)\(Int(diff.rounded())) bpm"
            ))
        }

        if let usual = stored.aboveThresholdMedianS,
           usual > 30,
           let currentZones = currentHRZones {
            let currentAbove = (currentZones["Zone 4"]?.seconds ?? 0)
                + (currentZones["Zone 5"]?.seconds ?? 0)
            let pct = ((currentAbove - usual) / usual * 100).rounded()
            let sign = pct >= 0 ? "+" : ""
            rows.append(UsualRow(
                label: "Above threshold",
                currentValue: currentAbove,
                usualValue: usual,
                minVal: 0,
                maxVal: max(currentAbove, usual) * 1.2,
                deltaLabel: "\(sign)\(Int(pct))%"
            ))
        }

        return rows
    }

    /// Used when the activity JSON carries no stored `vs_usual` block: computes the same
    /// comparison from the 20 most recent same-sport entries in `SyncCache` — matching
    /// `engine/core/vs_usual.py`'s `BASELINE_LIMIT` so the on-device fallback and the
    /// server-computed baseline agree on window size.
    static func cachedRows(
        allEntries: [SyncCacheEntry],
        currentSportType: String,
        currentFileName: String,
        currentElapsedTime: Int,
        currentAverageHeartrate: Double?,
        currentHRZones: [String: HRZoneEntry]?
    ) -> [UsualRow] {
        let prior = Array(
            allEntries
                .filter { $0.sportType == currentSportType && $0.fileName != currentFileName }
                .sorted { $0.startDateLocal > $1.startDateLocal }
                .prefix(20)
        )
        var rows: [UsualRow] = []

        // Duration — always present; requires ≥2 prior sessions
        let durations = prior.map { Double($0.elapsedTime) }
        if durations.count >= 2 {
            let usual = median(durations)
            let current = Double(currentElapsedTime)
            let pct = ((current - usual) / usual * 100).rounded()
            let sign = pct >= 0 ? "+" : ""
            let all = durations + [current]
            rows.append(UsualRow(
                label: "Duration",
                currentValue: current,
                usualValue: usual,
                minVal: 0,
                maxVal: (all.max() ?? current) * 1.2,
                deltaLabel: "\(sign)\(Int(pct))%"
            ))
        }

        // Avg HR — present once stats have been backfilled
        let hrVals = prior.compactMap { $0.averageHeartrate }
        if hrVals.count >= 2, let currentHR = currentAverageHeartrate {
            let usual = median(hrVals)
            let diff = currentHR - usual
            let sign = diff >= 0 ? "+" : ""
            let all = hrVals + [currentHR]
            rows.append(UsualRow(
                label: "Avg HR",
                currentValue: currentHR,
                usualValue: usual,
                minVal: (all.min() ?? currentHR) * 0.92,
                maxVal: (all.max() ?? currentHR) * 1.08,
                deltaLabel: "\(sign)\(Int(diff.rounded())) bpm"
            ))
        }

        // Above threshold (Zone 4 + Zone 5) — needs full Activity cached
        let aboveVals: [Double] = prior.compactMap { e in
            guard let z = e.activity?.hrZones else { return nil }
            return (z["Zone 4"]?.seconds ?? 0) + (z["Zone 5"]?.seconds ?? 0)
        }
        if aboveVals.count >= 2 {
            let currentAbove = (currentHRZones?["Zone 4"]?.seconds ?? 0) + (currentHRZones?["Zone 5"]?.seconds ?? 0)
            let usual = median(aboveVals)
            if usual > 30 {
                let pct = ((currentAbove - usual) / usual * 100).rounded()
                let sign = pct >= 0 ? "+" : ""
                let all = aboveVals + [currentAbove]
                rows.append(UsualRow(
                    label: "Above threshold",
                    currentValue: currentAbove,
                    usualValue: usual,
                    minVal: 0,
                    maxVal: (all.max() ?? currentAbove) * 1.2,
                    deltaLabel: "\(sign)\(Int(pct))%"
                ))
            }
        }

        return rows
    }

    static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let n = sorted.count
        guard n > 0 else { return 0 }
        return n % 2 == 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[n/2]
    }
}
