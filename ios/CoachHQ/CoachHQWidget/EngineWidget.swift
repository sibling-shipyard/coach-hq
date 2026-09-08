import WidgetKit
import SwiftUI

struct EngineEntry: TimelineEntry {
    let date: Date
    let sizes: EngineSizes?
    let isPlaceholder: Bool
}

struct EngineProvider: TimelineProvider {
    /// Golden dataset (ADR 0007) — used for the Add Widget gallery preview and the redacted
    /// system placeholder. Never used for deployed home-screen widgets (those read App Group cache).
    private static var previewSizes: EngineSizes { GoldenDataset.snapshots.sizes.engine }

    func placeholder(in context: Context) -> EngineEntry {
        EngineEntry(date: Date(), sizes: Self.previewSizes, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (EngineEntry) -> Void) {
        if context.isPreview {
            completion(EngineEntry(date: Date(), sizes: Self.previewSizes, isPlaceholder: false))
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
            let scale = EngineGraphics.localScale(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh)
            engineBandStrip(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh, scaleLow: scale.low, scaleHigh: scale.high)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - M — adds the 6-week trend sparkline

    private func mediumContent(_ engine: EngineSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            header(weekLabel: engine.weekLabel, signal: engine.signal)
            readout(load: engine.load, verdict: engine.compactVerdict ?? engine.verdict)
            engineBandStrip(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh, scaleLow: engine.scaleLow, scaleHigh: engine.scaleHigh)
            if !engine.trend.isEmpty {
                EngineGraphics.trendSparkline(engine.trend, color: .white.opacity(0.85), lineWidth: 2)
                    .frame(height: 28)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - L — adds the sport mix bar + method footnote

    private func largeContent(_ engine: EngineSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            header(weekLabel: engine.weekLabel, signal: engine.signal)
            readout(load: engine.load, verdict: engine.verdict)
            engineBandStrip(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh, scaleLow: engine.scaleLow, scaleHigh: engine.scaleHigh)
            if !engine.trend.isEmpty {
                EngineGraphics.trendSparkline(engine.trend, color: .white.opacity(0.85), lineWidth: 2)
                    .frame(height: 28)
            }
            if !engine.mix.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    EngineGraphics.mixBar(
                        engine.mix,
                        totalHours: engine.totalHours,
                        segmentSpacing: 1,
                        segmentCornerRadius: 0,
                        minSegmentWidth: 0,
                        outerClip: AnyShape(Capsule()),
                        showRemainder: false
                    )
                    .frame(height: 7)

                    Text(String(format: "%.1fH LOGGED", engine.totalHours))
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            Text(engine.method)
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Shared pieces (band strip / trend / mix maths live in EngineGraphics, W3)

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
            Text(EngineGraphics.numberString(load))
                .font(.system(size: 32, weight: .heavy, design: .monospaced))
                .foregroundColor(.white)
            Text(verdict)
                .font(.system(size: 12, design: .serif).italic())
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(1)
        }
    }

    private func engineBandStrip(load: Double, bandLow: Double?, bandHigh: Double?, scaleLow: Double, scaleHigh: Double) -> some View {
        EngineGraphics.bandStrip(
            load: load,
            bandLow: bandLow,
            bandHigh: bandHigh,
            scaleLow: scaleLow,
            scaleHigh: scaleHigh,
            progress: 1,
            trackHeight: 5,
            bandHeight: 8,
            dotSize: 8,
            minBandWidth: 8,
            clampDotOffset: false,
            trackColor: Color.white.opacity(0.18),
            bandColor: Color.white.opacity(0.55),
            dotColor: .white
        )
        .frame(height: 10)
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
