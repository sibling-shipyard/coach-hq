import WidgetKit
import SwiftUI

/// Same note as `TrainingActivityWidget` — one `home.vo2: Vo2Snapshot` shape, sliced smaller
/// per family. "Number + ▲ delta survive to S; trend at M" per the Design Philosophy's VO2 entry.
struct Vo2Entry: TimelineEntry {
    let date: Date
    let vo2: Vo2Snapshot?
    let isPlaceholder: Bool
}

struct Vo2Provider: TimelineProvider {
    func placeholder(in context: Context) -> Vo2Entry {
        let snapshot = Vo2Snapshot(status: "available", value: 0, delta: 0, percentileLabel: "—", trend: [], read: "—")
        return Vo2Entry(date: Date(), vo2: snapshot, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (Vo2Entry) -> Void) {
        completion(Vo2Entry(date: Date(), vo2: AppGroupSnapshotBridge.read()?.home.vo2, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Vo2Entry>) -> Void) {
        let entry = Vo2Entry(date: Date(), vo2: AppGroupSnapshotBridge.read()?.home.vo2, isPlaceholder: false)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct Vo2WidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: Vo2Entry

    var body: some View {
        Group {
            if let vo2 = entry.vo2, vo2.isAvailable, let value = vo2.value {
                switch family {
                case .systemMedium:
                    mediumContent(vo2, value)
                default:
                    smallContent(vo2, value)
                }
            } else {
                EmptyGlanceView(label: "VO₂ MAX", message: "No Apple Health VO₂ observations")
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.paper }
    }

    /// S — number + delta only.
    private func smallContent(_ vo2: Vo2Snapshot, _ value: Double) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoLabel("VO₂ MAX")
            Spacer(minLength: 0)
            Text(String(format: "%.1f", value))
                .font(WarmInstrument.figures(24, weight: .bold))
                .foregroundColor(WarmInstrument.ink)
            if let delta = vo2.delta {
                Text("▲ \(String(format: "%.1f", delta))")
                    .font(.system(size: 10))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// M — adds the 12-month trend sparkline and percentile context.
    private func mediumContent(_ vo2: Vo2Snapshot, _ value: Double) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                MonoLabel("VO₂ MAX · 12 MO")
                Spacer()
                if let percentile = vo2.percentileLabel {
                    Text(percentile)
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(WarmInstrument.accent)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(String(format: "%.1f", value))
                    .font(WarmInstrument.figures(22, weight: .bold))
                    .foregroundColor(WarmInstrument.ink)
                if let delta = vo2.delta {
                    Text("ml/kg/min · ▲ \(String(format: "%.1f", delta))")
                        .font(.system(size: 9))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }
            if vo2.trend.count > 1 {
                sparkline(vo2.trend).frame(height: 24)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sparkline(_ points: [TrendPointSnapshot]) -> some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        return GeometryReader { geo in
            Path { path in
                for (index, point) in points.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(max(1, points.count - 1))
                    let y = geo.size.height - geo.size.height * CGFloat((point.value - minV) / range)
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(WarmInstrument.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
    }
}

struct Vo2Widget: Widget {
    let kind = "com.coachphelps.ios.widget.vo2"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Vo2Provider()) { entry in
            Vo2WidgetView(entry: entry)
        }
        .configurationDisplayName("VO₂ Max")
        .description("The long game — 12-month trend.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
