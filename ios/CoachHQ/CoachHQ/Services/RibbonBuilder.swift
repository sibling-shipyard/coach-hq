import Foundation

/// Turns a recorded HR stream into one zone index per ribbon cell.
///
/// Pure and free of SwiftUI so it can be tested directly — the ribbon is the only place an
/// athlete reads the shape of a session, and getting a cell's zone wrong puts a colour on screen
/// that the legend beneath will contradict.
enum RibbonBuilder {

    /// Cell count for a ribbon drawn from recorded heart rate: ~1 cell per 30s, clamped 5–48.
    ///
    /// The ribbon is a fixed ~321pt wide (phone width less screen and card padding) with 1.5pt
    /// between cells, so count and width trade off directly. 48 cells is 5.4pt each; past roughly
    /// 50 a cell is thinner than the gap beside it and the ribbon reads as a smear rather than as
    /// bands. Without the cap, 30s cells on a 90-minute session would be 180 sub-pixel slivers.
    static func cellCount(elapsedSeconds: Int) -> Int {
        min(48, max(5, elapsedSeconds / 30))
    }

    /// Zone index per cell, left to right. `nil` where no reading covers the slice.
    ///
    /// **Time-weighted, not a plain mean.** The points are min/max decimated, so extremes are
    /// deliberately over-represented relative to how long they were actually held. Averaging them
    /// evenly lets a two-second spike drag a whole 30-second cell into Threshold. Each point is
    /// instead weighted by the span it owns inside the slice.
    static func zonesPerCell(
        stream: HRStreamFile,
        config: HRZoneConfig,
        cells: Int
    ) -> [Int?] {
        guard cells > 0, stream.elapsedSeconds > 0, !stream.points.isEmpty else {
            return Array(repeating: nil, count: max(0, cells))
        }

        let points = stream.points.sorted { $0.t < $1.t }
        let slice = Double(stream.elapsedSeconds) / Double(cells)
        var out: [Int?] = []

        for i in 0..<cells {
            let lo = Double(i) * slice
            let hi = Double(i + 1) * slice

            // Each point owns from its own timestamp to the next one, clipped to this cell.
            var weightPerZone = [Double](repeating: 0, count: 5)
            var covered = 0.0

            for (j, p) in points.enumerated() {
                let from = Double(p.t)
                let to = j + 1 < points.count ? Double(points[j + 1].t) : Double(stream.elapsedSeconds)
                let overlap = min(to, hi) - max(from, lo)
                guard overlap > 0 else { continue }
                weightPerZone[zoneIndex(forBPM: Double(p.bpm), config: config)] += overlap
                covered += overlap
            }

            guard covered > 0,
                  let best = weightPerZone.enumerated().max(by: { $0.element < $1.element })?.offset
            else {
                out.append(nil)
                continue
            }
            out.append(best)
        }
        return out
    }

    /// Fills `nil` cells by carrying the previous known zone, reaching forward for the opening run.
    ///
    /// A blank cell in a 29-cell ribbon reads as a rendering fault rather than as missing data.
    /// The honest accounting of uncovered time is the legend beneath, which never counts it.
    static func carryGaps(_ zones: [Int?]) -> [Int] {
        let firstKnown = zones.compactMap { $0 }.first ?? 0
        var last = firstKnown
        return zones.map { z in
            if let z { last = z; return z }
            return last
        }
    }

    /// Boundaries the activity was actually scored against, recovered from its stored zones.
    ///
    /// The ribbon must not be coloured with today's settings: `hr_zones` records the `high` of
    /// each zone as it stood at sync time, and the legend below renders those same stored
    /// seconds. Reading live `UserDefaults` instead would let a settings change recolour history
    /// into disagreement with the numbers printed beneath it. Falls back to current settings only
    /// when an activity carries no boundaries at all.
    static func storedConfig(from zones: [String: HRZoneEntry]?) -> HRZoneConfig {
        guard let zones,
              let z1 = zones["Zone 1"]?.high,
              let z2 = zones["Zone 2"]?.high,
              let z3 = zones["Zone 3"]?.high,
              let z4 = zones["Zone 4"]?.high
        else { return .current }
        return HRZoneConfig(zone1Upper: z1, zone2Upper: z2, zone3Upper: z3, zone4Upper: z4)
    }

    static func zoneIndex(forBPM bpm: Double, config: HRZoneConfig) -> Int {
        let v = Int(bpm.rounded())
        if v <= config.zone1Upper { return 0 }
        if v <= config.zone2Upper { return 1 }
        if v <= config.zone3Upper { return 2 }
        if v <= config.zone4Upper { return 3 }
        return 4
    }

    /// Estimated zone sequence for a session with no recorded HR stream: work zones shuffled in
    /// bursts with recovery spread evenly between them, matching the mock's `zoneSequence`
    /// algorithm. `seedKey` seeds the shuffle so the same activity always renders the same
    /// estimate — callers pass something stable per activity, e.g. its filename.
    static func estimatedSequence(elapsedSeconds: Int, zones: [String: HRZoneEntry], seedKey: String) -> [Int] {
        // Scale cell count to session length: ~1 cell per 4 min, clamped 5–41.
        // Avoids ultra-thin barcode look on short sessions (e.g. 12-min foundation).
        let cellCount = min(41, max(5, elapsedSeconds / 240))
        let totalSecs = HRZone.keys.reduce(0.0) { $0 + (zones[$1]?.seconds ?? 0) }
        guard totalSecs > 0 else { return [] }

        // Largest-remainder allocation of cellCount across zones
        let rawCounts = HRZone.keys.map { Double(zones[$0]?.seconds ?? 0) / totalSecs * Double(cellCount) }
        var counts = rawCounts.map { Int($0) }
        let leftover = cellCount - counts.reduce(0, +)
        rawCounts.enumerated()
            .map { (idx: $0.offset, frac: $0.element - Double(counts[$0.offset])) }
            .sorted { $0.frac > $1.frac }
            .prefix(leftover)
            .forEach { counts[$0.idx] += 1 }

        // Build work array (zones 1–4 = Base through VO₂ Max) and shuffle with seeded RNG
        var work: [Int] = []
        for i in 1...4 { for _ in 0..<counts[i] { work.append(i) } }

        var seed = UInt64(bitPattern: Int64(truncatingIfNeeded: seedKey.hashValue))
        for i in stride(from: work.count - 1, through: 1, by: -1) {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            let j = Int(seed >> 33) % (i + 1)
            work.swapAt(i, j)
        }

        // Group work cells into bursts of 3, spread recovery between gaps
        var groups: [[Int]] = []
        var i = 0
        while i < work.count { groups.append(Array(work[i..<min(i + 3, work.count)])); i += 3 }

        let recCount = counts[0]
        let gapCount = groups.count + 1
        var seq: [Int] = []
        for (g, group) in groups.enumerated() {
            let from = g * recCount / gapCount
            let to   = (g + 1) * recCount / gapCount
            for _ in 0..<(to - from) { seq.append(0) }
            seq.append(contentsOf: group)
        }
        let lastFrom = groups.count * recCount / gapCount
        for _ in lastFrom..<recCount { seq.append(0) }

        return seq
    }
}
