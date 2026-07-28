import WidgetKit
import SwiftUI

struct EngineEntry: TimelineEntry {
    let date: Date
    let sizes: EngineSizes?
    let isPlaceholder: Bool
}

struct EngineProvider: TimelineProvider {
    /// Representative sample data — used for the redacted system placeholder (`placeholder(in:)`,
    /// shimmered so exact values don't matter) and, unredacted, for the widget gallery's "Add
    /// Widget" preview (`getSnapshot` when `context.isPreview`). Numbers mirror the Design
    /// Philosophy's own worked example ("549 — in the band," 447–671 rhythm band) so the gallery
    /// preview looks like a real, legible widget instead of the empty/no-data state — standard
    /// WidgetKit convention (see Apple's own Weather/Stocks widgets), distinct from the "never
    /// fabricate data on the home screen" rule, which is about the *deployed* widget once added.
    private static var sampleSizes: EngineSizes {
        let s = EngineSnapshotS(weekLabel: "WK 30", load: 549, signal: "IN BAND", compactVerdict: "In the band.", bandLow: 447, bandHigh: 671)
        let trend = [
            TrendPointSnapshot(label: "1 Jun", value: 512, weekLabel: "WK 23"),
            TrendPointSnapshot(label: "8 Jun", value: 588, weekLabel: "WK 24"),
            TrendPointSnapshot(label: "15 Jun", value: 471, weekLabel: "WK 25"),
            TrendPointSnapshot(label: "22 Jun", value: 604, weekLabel: "WK 26"),
            TrendPointSnapshot(label: "29 Jun", value: 559, weekLabel: "WK 27"),
            TrendPointSnapshot(label: "6 Jul", value: 617, weekLabel: "WK 28"),
            TrendPointSnapshot(label: "13 Jul", value: 533, weekLabel: "WK 29"),
            TrendPointSnapshot(label: "20 Jul", value: 549, weekLabel: "WK 30"),
        ]
        let mix = [
            LoadMixSnapshot(id: .badminton, label: "Badminton", shortLabel: "BDM", hours: 3.2, color: "#315a4a"),
            LoadMixSnapshot(id: .foundation, label: "Foundation", shortLabel: "FDN", hours: 2.1, color: "#6d7d4e"),
            LoadMixSnapshot(id: .cycling, label: "Ride", shortLabel: "RIDE", hours: 1.2, color: "#a8702c"),
        ]
        let full = EngineSnapshot(
            weekLabel: "WK 30", load: 549, signal: "IN BAND", verdict: "Optimal.", compactVerdict: "In the band.",
            openVerdict: "Hold here.", bandLow: 447, bandHigh: 671, scaleLow: 0, scaleHigh: 800, trend: trend,
            mix: mix, totalHours: 6.5, method: "8-week rolling median · sample data", doseRows: []
        )
        return EngineSizes(S: s, M: full, L: full)
    }

    func placeholder(in context: Context) -> EngineEntry {
        EngineEntry(date: Date(), sizes: Self.sampleSizes, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (EngineEntry) -> Void) {
        if context.isPreview {
            completion(EngineEntry(date: Date(), sizes: Self.sampleSizes, isPlaceholder: false))
            return
        }
        completion(EngineEntry(date: Date(), sizes: AppGroupSnapshotBridge.read()?.sizes.engine, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EngineEntry>) -> Void) {
        let entry = EngineEntry(date: Date(), sizes: AppGroupSnapshotBridge.read()?.sizes.engine, isPlaceholder: false)
        // Safety-net refresh — the app calls `WidgetCenter.reloadAllTimelines()` right after
        // every sync/refresh, so this window is a fallback, not the primary update path.
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct EngineWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: EngineEntry

    var body: some View {
        Group {
            if let sizes = entry.sizes {
                switch family {
                case .systemLarge:
                    largeContent(sizes.L)
                case .systemMedium:
                    mediumContent(sizes.M)
                default:
                    smallContent(sizes.S)
                }
            } else {
                emptyState
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.accent }
    }

    // MARK: - S — number + band strip only

    private func smallContent(_ engine: EngineSnapshotS) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            header(weekLabel: engine.weekLabel, signal: engine.signal)
            readout(load: engine.load, verdict: engine.compactVerdict)
            bandStrip(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - M — adds the 6-week trend sparkline

    private func mediumContent(_ engine: EngineSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            header(weekLabel: engine.weekLabel, signal: engine.signal)
            readout(load: engine.load, verdict: engine.compactVerdict ?? engine.verdict)
            bandStrip(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh)
            if !engine.trend.isEmpty {
                trendSparkline(engine.trend)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - L — adds the sport mix bar + method footnote

    private func largeContent(_ engine: EngineSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            header(weekLabel: engine.weekLabel, signal: engine.signal)
            readout(load: engine.load, verdict: engine.verdict)
            bandStrip(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh)
            if !engine.trend.isEmpty {
                trendSparkline(engine.trend)
            }
            if !engine.mix.isEmpty {
                mixBar(engine.mix, totalHours: engine.totalHours)
            }
            Text(engine.method)
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Shared pieces (mirror the in-app Engine widget's math 1:1)

    private func header(weekLabel: String, signal: String) -> some View {
        HStack {
            Text("ENGINE · \(weekLabel)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.0)
                .foregroundColor(.white.opacity(0.75))
            Spacer()
            Text(signal)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.0)
                .foregroundColor(.white)
        }
    }

    private func readout(load: Double, verdict: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(numberString(load))
                .font(.system(size: 32, weight: .heavy, design: .monospaced))
                .foregroundColor(.white)
            Text(verdict)
                .font(.system(size: 12, design: .serif).italic())
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(1)
        }
    }

    private func bandStrip(load: Double, bandLow: Double?, bandHigh: Double?) -> some View {
        GeometryReader { geo in
            let low = bandLow ?? load * 0.8
            let high = max(bandHigh ?? load * 1.2, low + 1)
            let scaleLow = min(low, load) * 0.85
            let scaleHigh = max(high, load) * 1.15 + 1
            let range = max(1, scaleHigh - scaleLow)
            let xLow = CGFloat((low - scaleLow) / range) * geo.size.width
            let xHigh = CGFloat((high - scaleLow) / range) * geo.size.width
            let xLoad = CGFloat((load - scaleLow) / range) * geo.size.width

            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.18)).frame(height: 5)
                Capsule()
                    .fill(Color.white.opacity(0.55))
                    .frame(width: max(8, xHigh - xLow), height: 8)
                    .offset(x: xLow)
                Circle()
                    .fill(Color.white)
                    .frame(width: 8, height: 8)
                    .offset(x: xLoad - 4)
            }
        }
        .frame(height: 10)
    }

    private func trendSparkline(_ points: [TrendPointSnapshot]) -> some View {
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
            .stroke(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
        .frame(height: 28)
    }

    private func mixBar(_ mix: [LoadMixSnapshot], totalHours: Double) -> some View {
        let denominator = max(totalHours, mix.reduce(0) { $0 + $1.hours }, 1)
        return VStack(alignment: .leading, spacing: 5) {
            GeometryReader { geo in
                HStack(spacing: 1) {
                    ForEach(mix.filter { $0.hours > 0 }) { item in
                        Rectangle()
                            .fill(WarmInstrument.color(hex: item.color))
                            .frame(width: geo.size.width * CGFloat(item.hours / denominator))
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 7)

            Text(String(format: "%.1fH LOGGED", totalHours))
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.7))
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ENGINE")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.0)
                .foregroundColor(.white.opacity(0.75))
            Spacer()
            Text("No sync yet")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func numberString(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

struct EngineWidget: Widget {
    let kind = "com.siblingshipyard.coachhq.widget.engine"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: EngineProvider()) { entry in
            EngineWidgetView(entry: entry)
        }
        .configurationDisplayName("Engine")
        .description("This week's load vs your rhythm band.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
