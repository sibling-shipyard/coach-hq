import WidgetKit
import SwiftUI

struct EngineEntry: TimelineEntry {
    let date: Date
    let engine: EngineSnapshotS?
    let isPlaceholder: Bool
}

struct EngineProvider: TimelineProvider {
    func placeholder(in context: Context) -> EngineEntry {
        EngineEntry(
            date: Date(),
            engine: EngineSnapshotS(weekLabel: "WK —", load: 0, signal: "—", compactVerdict: "—", bandLow: nil, bandHigh: nil),
            isPlaceholder: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (EngineEntry) -> Void) {
        completion(EngineEntry(date: Date(), engine: AppGroupSnapshotBridge.read()?.sizes.engine.S, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EngineEntry>) -> Void) {
        let entry = EngineEntry(date: Date(), engine: AppGroupSnapshotBridge.read()?.sizes.engine.S, isPlaceholder: false)
        // Safety-net refresh — the app calls `WidgetCenter.reloadAllTimelines()` right after
        // every sync/refresh, so this window is a fallback, not the primary update path.
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct EngineWidgetView: View {
    let entry: EngineEntry

    var body: some View {
        Group {
            if let engine = entry.engine {
                content(engine)
            } else {
                emptyState
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.accent }
    }

    /// Own empty state rather than the shared `EmptyGlanceView` — Engine sits on the dark
    /// terracotta fill, not the paper surface the other two widgets use.
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

    private func content(_ engine: EngineSnapshotS) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ENGINE · \(engine.weekLabel)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.0)
                .foregroundColor(.white.opacity(0.75))

            Text(numberString(engine.load))
                .font(.system(size: 32, weight: .heavy, design: .monospaced))
                .foregroundColor(.white)

            Text(engine.compactVerdict)
                .font(.system(size: 12, design: .serif).italic())
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(1)

            bandStrip(engine)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Same band-strip math as the in-app Engine widget (`WarmInstrumentHomeView.swift`) —
    /// duplicated rather than shared because the app's version is a `View` extension tied to
    /// `GeometryReader` inside a much larger widget; not worth threading a shared type through
    /// two targets for one small shape.
    private func bandStrip(_ engine: EngineSnapshotS) -> some View {
        GeometryReader { geo in
            let load = engine.load
            let low = engine.bandLow ?? load * 0.8
            let high = max(engine.bandHigh ?? load * 1.2, low + 1)
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

    private func numberString(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

struct EngineWidget: Widget {
    let kind = "com.coachphelps.ios.widget.engine"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: EngineProvider()) { entry in
            EngineWidgetView(entry: entry)
        }
        .configurationDisplayName("Engine")
        .description("This week's load vs your rhythm band.")
        .supportedFamilies([.systemSmall])
    }
}
