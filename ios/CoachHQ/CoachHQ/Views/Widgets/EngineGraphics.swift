import SwiftUI

/// Engine's shared drawing maths — the band strip, trend sparkline, and load-mix bar — used by
/// both the in-app `EngineCard` and WidgetKit's `EngineWidgetView`
/// (`CoachHQWidget/EngineWidget.swift`). Pure functions of primitive values: no `@State`, no
/// `containerBackground`, no card chrome. Each surface keeps its own sizes, colors, and
/// surrounding content — see `bandStrip` below for the scale decision this consolidation
/// carries out.
enum EngineGraphics {
    /// Raw "usual band" bounds before scale padding — the single source both `localScale` (pads
    /// this into an axis range) and `bandStrip` (draws the capsule at these exact bounds) build on.
    private static func bandBounds(load: Double, bandLow: Double?, bandHigh: Double?) -> (low: Double, high: Double) {
        let low = bandLow ?? load * 0.8
        let high = max(bandHigh ?? load * 1.2, low + 1)
        return (low, high)
    }

    /// Local scale heuristic for sizes with no pipeline-computed scale (`EngineSnapshotS` —
    /// LLD §1). M/L callers should pass `engine.scaleLow`/`engine.scaleHigh` instead of this.
    static func localScale(load: Double, bandLow: Double?, bandHigh: Double?) -> (low: Double, high: Double) {
        let (low, high) = bandBounds(load: load, bandLow: bandLow, bandHigh: bandHigh)
        return (min(low, load) * 0.85, max(high, load) * 1.15 + 1)
    }

    /// Track + band capsule + load dot, positioned against `scaleLow`/`scaleHigh`. Callers
    /// compute the scale themselves (pipeline for M/L, `localScale` for S) — this only draws.
    static func bandStrip(
        load: Double,
        bandLow: Double?,
        bandHigh: Double?,
        scaleLow: Double,
        scaleHigh: Double,
        progress: Double,
        trackHeight: CGFloat,
        bandHeight: CGFloat,
        dotSize: CGFloat,
        minBandWidth: CGFloat,
        clampDotOffset: Bool,
        trackColor: Color,
        bandColor: Color,
        dotColor: Color
    ) -> some View {
        GeometryReader { geo in
            let (low, high) = bandBounds(load: load, bandLow: bandLow, bandHigh: bandHigh)
            let range = max(1, scaleHigh - scaleLow)
            let xLow = CGFloat((low - scaleLow) / range) * geo.size.width
            let xHigh = CGFloat((high - scaleLow) / range) * geo.size.width
            let xLoad = CGFloat((load - scaleLow) / range) * geo.size.width
            let dotOffset = xLoad * progress - dotSize / 2

            ZStack(alignment: .leading) {
                Capsule().fill(trackColor).frame(height: trackHeight)
                Capsule()
                    .fill(bandColor)
                    .frame(width: max(minBandWidth, xHigh - xLow) * progress, height: bandHeight)
                    .offset(x: xLow * progress)
                Circle()
                    .fill(dotColor)
                    .frame(width: dotSize, height: dotSize)
                    .offset(x: clampDotOffset ? max(0, dotOffset) : dotOffset)
            }
        }
    }

    /// 6-week (or however many points) line trend, normalized to its own min/max.
    static func trendSparkline(_ points: [TrendPointSnapshot], color: Color, lineWidth: CGFloat) -> some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        return GeometryReader { geo in
            Path { path in
                for (index, point) in points.enumerated() {
                    let x = points.count > 1
                        ? geo.size.width * CGFloat(index) / CGFloat(points.count - 1)
                        : geo.size.width
                    let y = geo.size.height - geo.size.height * CGFloat((point.value - minV) / range)
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
        }
    }

    /// Proportional sport-mix bar — just the bar. Callers add their own footer (Home's per-sport
    /// legend vs WidgetKit's single "X.XH LOGGED" line) outside this function.
    static func mixBar(
        _ mix: [LoadMixSnapshot],
        totalHours: Double,
        segmentSpacing: CGFloat,
        segmentCornerRadius: CGFloat,
        minSegmentWidth: CGFloat,
        outerClip: AnyShape,
        showRemainder: Bool,
        remainderColor: Color = .clear
    ) -> some View {
        let trackedHours = mix.reduce(0) { $0 + $1.hours }
        let denominator = max(totalHours, trackedHours, 1)
        let activeMix = mix.filter { $0.hours > 0 }
        return GeometryReader { geo in
            HStack(spacing: segmentSpacing) {
                ForEach(activeMix) { item in
                    RoundedRectangle(cornerRadius: segmentCornerRadius, style: .continuous)
                        .fill(WarmInstrument.color(hex: item.color))
                        .frame(width: max(minSegmentWidth, geo.size.width * CGFloat(item.hours / denominator)))
                }
                if showRemainder, trackedHours < totalHours {
                    RoundedRectangle(cornerRadius: segmentCornerRadius, style: .continuous)
                        .fill(remainderColor)
                        .frame(maxWidth: .infinity)
                }
            }
            .clipShape(outerClip)
        }
    }
}
