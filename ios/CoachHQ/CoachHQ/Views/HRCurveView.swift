import SwiftUI

/// Heart rate over time for a single activity, drawn from the `streams/<uuid>.json` sidecar.
///
/// Hand-drawn with `Path` rather than Swift Charts: the codebase draws its own marks already,
/// and the one thing this view must get right — a dropout rendering as a break rather than a
/// straight line across it — is exactly what a charting library makes awkward.
///
/// **Gaps are never bridged.** A line drawn across a sensor dropout is a claim we did not
/// measure. Each covered segment is stroked as its own subpath.
struct HRCurveView: View {
    let stream: HRStreamFile
    /// Zone palette from the detail screen, Recovery → VO₂ Max.
    let zoneColors: [Color]
    let config: HRZoneConfig

    private var bpmRange: ClosedRange<Double> {
        let values = stream.points.map { Double($0.bpm) }
        guard let lo = values.min(), let hi = values.max(), hi > lo else { return 60...180 }
        // Pad so the trace never touches the frame edge.
        let pad = max(6, (hi - lo) * 0.12)
        return (lo - pad)...(hi + pad)
    }

    /// Points split into runs of continuous coverage. A run break is a gap from the sidecar.
    ///
    /// Points and gaps both arrive sorted by `t`, so one pass with a gap cursor is enough.
    private var segments: [[HRPoint]] {
        guard !stream.points.isEmpty else { return [] }
        guard !stream.gaps.isEmpty else { return [stream.points] }

        let gaps = stream.gaps.sorted { $0.from < $1.from }
        var out: [[HRPoint]] = []
        var current: [HRPoint] = []
        var gapIndex = 0

        for p in stream.points {
            // Close the current run each time this point lands past the next gap.
            while gapIndex < gaps.count, p.t >= gaps[gapIndex].to {
                if !current.isEmpty { out.append(current); current = [] }
                gapIndex += 1
            }
            current.append(p)
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    // Point mapping lives outside the view builder — a result-builder closure cannot contain
    // local function declarations.
    private func px(_ t: Int, width: CGFloat) -> CGFloat {
        let elapsed = max(Double(stream.elapsedSeconds), 1)
        return CGFloat(min(1, max(0, Double(t) / elapsed))) * width
    }

    private func py(_ bpm: Int, height: CGFloat, range: ClosedRange<Double>) -> CGFloat {
        let span = max(range.upperBound - range.lowerBound, 1)
        return height - CGFloat((Double(bpm) - range.lowerBound) / span) * height
    }

    private func trace(_ seg: [HRPoint], size: CGSize, range: ClosedRange<Double>) -> Path {
        var path = Path()
        guard let first = seg.first else { return path }
        path.move(to: CGPoint(x: px(first.t, width: size.width),
                              y: py(first.bpm, height: size.height, range: range)))
        for p in seg.dropFirst() {
            path.addLine(to: CGPoint(x: px(p.t, width: size.width),
                                     y: py(p.bpm, height: size.height, range: range)))
        }
        return path
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    // Zone bands behind the trace — reading the curve against them is how you
                    // see "most of this was Zone 3" without consulting the legend.
                    ForEach(zoneBands(range: bpmRange), id: \.lower) { band in
                        Rectangle()
                            .fill(zoneColors[band.index].opacity(0.16))
                            .frame(
                                width: geo.size.width,
                                height: max(0, py(Int(band.lower), height: geo.size.height, range: bpmRange)
                                            - py(Int(band.upper), height: geo.size.height, range: bpmRange))
                            )
                            .offset(y: py(Int(band.upper), height: geo.size.height, range: bpmRange))
                    }

                    ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                        trace(seg, size: geo.size, range: bpmRange)
                            .stroke(
                                Color(red: 0x2b/255, green: 0x2d/255, blue: 0x29/255).opacity(0.82),
                                style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round)
                            )
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            .frame(height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))

            if stream.uncoveredSeconds > 0 {
                Text(uncoveredNote)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// Zone bands clipped to the visible bpm range, so a session that never left Zone 2 does
    /// not paint four irrelevant stripes.
    private func zoneBands(range: ClosedRange<Double>) -> [(index: Int, lower: Double, upper: Double)] {
        let uppers = [config.zone1Upper, config.zone2Upper, config.zone3Upper, config.zone4Upper]
        var bounds: [(Int, Double, Double)] = []
        var lower = 0.0
        for (i, u) in uppers.enumerated() {
            bounds.append((i, lower, Double(u)))
            lower = Double(u)
        }
        bounds.append((4, lower, 260))

        return bounds.compactMap { (i, lo, hi) in
            let clampedLo = max(lo, range.lowerBound)
            let clampedHi = min(hi, range.upperBound)
            guard clampedHi > clampedLo else { return nil }
            return (index: i, lower: clampedLo, upper: clampedHi)
        }
    }

    private var uncoveredNote: String {
        let mins = stream.uncoveredSeconds / 60
        let unit = mins >= 1 ? "\(mins) min" : "\(stream.uncoveredSeconds)s"
        return "\(unit) without heart-rate coverage — shown as breaks, not estimated."
    }

    private var accessibilityText: String {
        let lo = stream.points.map(\.bpm).min() ?? 0
        let hi = stream.points.map(\.bpm).max() ?? 0
        var text = "Heart rate over time. Low \(lo), peak \(hi) beats per minute."
        if !stream.gaps.isEmpty {
            text += " \(stream.gaps.count) gap\(stream.gaps.count == 1 ? "" : "s") in coverage."
        }
        return text
    }
}
