import SwiftUI

/// In-app Engine card — S/M/L density. WidgetKit's home-screen Engine widget is the separate
/// `struct EngineWidget: Widget` in `CoachHQWidget/EngineWidget.swift`; the two only stay
/// distinct names because this one moved here (W2 of docs/plans/ios-widget-modules.md).
///
/// Shares its band strip / trend / mix-bar maths with WidgetKit via `EngineGraphics` (W3) — see
/// docs/plans/ios-widget-modules-lld.md §1 for the scale decision: `.l` draws its band marker
/// against the pipeline's `scaleLow`/`scaleHigh` instead of a locally-recomputed range, which is
/// what moves the marker to agree with `EngineDetailView`'s gauge for the same week. `.s` still
/// falls back to `EngineGraphics.localScale` (no pipeline scale for that size — see its doc
/// comment); `.m` renders no band marker at all.
struct EngineCard: View {
    let size: WidgetSize
    let sizes: EngineSizes

    @State private var bandProgress: Double = 0

    var body: some View {
        WarmCard(padding: size == .m ? 20 : 18, fill: WarmInstrument.accent) {
            VStack(alignment: .leading, spacing: 14) {
                switch size {
                case .s:
                    header(weekLabel: sizes.S.weekLabel, signal: sizes.S.signal)
                    readout(load: sizes.S.load * bandProgress, verdict: sizes.S.compactVerdict)
                    let scale = EngineGraphics.localScale(load: sizes.S.load, bandLow: sizes.S.bandLow, bandHigh: sizes.S.bandHigh)
                    bandStrip(load: sizes.S.load, bandLow: sizes.S.bandLow, bandHigh: sizes.S.bandHigh, scaleLow: scale.low, scaleHigh: scale.high)
                case .m:
                    mobileHeader(weekLabel: sizes.M.weekLabel, signal: sizes.M.signal)
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(Format.number(sizes.M.load * bandProgress))
                                .font(.system(size: 46, weight: .medium, design: .default))
                                .tracking(-2)
                                .foregroundColor(.white)
                                .contentTransition(.numericText())
                            Text(sizes.M.compactVerdict ?? sizes.M.verdict)
                                .font(WarmInstrument.coachVoice(16))
                                .foregroundColor(.white.opacity(0.9))
                        }
                        .frame(width: 118, alignment: .leading)

                        mobileTrendSparkline(sizes.M.trend, bandLow: sizes.M.bandLow, bandHigh: sizes.M.bandHigh)
                            .drawingGroup()
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.top, 2)

                    mixBarSection(sizes.M.mix, totalHours: sizes.M.totalHours)
                        .padding(.top, 14)
                        .overlay(alignment: .top) {
                            Rectangle()
                                .fill(Color.white.opacity(0.16))
                                .frame(height: 1)
                                .padding(.top, -12)
                        }
                case .l:
                    header(weekLabel: sizes.L.weekLabel, signal: sizes.L.signal)
                    readout(load: sizes.L.load * bandProgress, verdict: sizes.L.verdict)
                    bandStrip(load: sizes.L.load, bandLow: sizes.L.bandLow, bandHigh: sizes.L.bandHigh, scaleLow: sizes.L.scaleLow, scaleHigh: sizes.L.scaleHigh)
                    EngineGraphics.trendSparkline(sizes.L.trend, color: .white.opacity(0.85), lineWidth: 2)
                        .frame(height: 40)
                    mixBarSection(sizes.L.mix, totalHours: sizes.L.totalHours)
                    Text(sizes.L.method)
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundColor(.white.opacity(0.65))
                }
            }
        }
        .shadow(color: WarmInstrument.engineShadow, radius: size == .m ? 24 : 20, x: 0, y: size == .m ? 12 : 10)
        .onChange(of: sizes.M.load) { _, _ in
            // Don't reset — only animate to 1.0 if the initial task hasn't finished yet.
            // Resetting on every foreground refresh caused a jarring count-from-zero on each return.
            withAnimation(.spring(duration: 0.7, bounce: 0.1).delay(0.05)) { bandProgress = 1.0 }
        }
        .task {
            try? await Task.sleep(for: .seconds(0.30))
            withAnimation(.spring(duration: 0.7, bounce: 0.1)) { bandProgress = 1.0 }
        }
    }

    private func header(weekLabel: String, signal: String) -> some View {
        HStack {
            Text("ENGINE · \(weekLabel)")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.1)
                .foregroundColor(.white.opacity(0.75))
            Spacer()
            Text(signal)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.1)
                .foregroundColor(.white)
        }
    }

    private func mobileHeader(weekLabel: String, signal: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("ENGINE")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.3)
                .foregroundColor(.white.opacity(0.65))
            Spacer()
            Text(weekLabel.uppercased())
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.3)
                .foregroundColor(.white.opacity(0.45))
        }
    }

    private func readout(load: Double, verdict: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(Format.number(load))
                .font(.system(size: 44, weight: .heavy, design: .monospaced))
                .foregroundColor(.white)
                .contentTransition(.numericText())
            Text(verdict)
                .font(.system(size: 15, design: .serif).italic())
                .foregroundColor(.white.opacity(0.85))
        }
    }

    private func bandStrip(load: Double, bandLow: Double?, bandHigh: Double?, scaleLow: Double, scaleHigh: Double) -> some View {
        EngineGraphics.bandStrip(
            load: load,
            bandLow: bandLow,
            bandHigh: bandHigh,
            scaleLow: scaleLow,
            scaleHigh: scaleHigh,
            progress: bandProgress,
            trackHeight: 6,
            bandHeight: 10,
            dotSize: 10,
            minBandWidth: 1,
            clampDotOffset: true,
            trackColor: Color.white.opacity(0.18),
            bandColor: Color.white.opacity(0.55),
            dotColor: .white
        )
        .frame(height: 12)
    }

    private func mobileTrendSparkline(_ points: [TrendPointSnapshot], bandLow: Double?, bandHigh: Double?) -> some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        let lowLabel = bandLow.map { "\(Int($0))–\(Int(bandHigh ?? $0)) USUAL" } ?? ""
        let firstLabel = points.first?.label.uppercased() ?? "6 WK"

        return GeometryReader { geo in
            let chartTop: CGFloat = 18
            let chartHeight: CGFloat = 34
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.white.opacity(0.09))
                    .frame(height: chartHeight)
                    .offset(y: chartTop)

                Path { path in
                    for (index, point) in points.enumerated() {
                        let x = points.count > 1
                            ? geo.size.width * CGFloat(index) / CGFloat(points.count - 1)
                            : geo.size.width
                        let normalized = (point.value - minV) / range
                        let y = chartTop + chartHeight - chartHeight * 0.65 * normalized - chartHeight * 0.15
                        if index == 0 { path.move(to: CGPoint(x: x, y: y)) }
                        else { path.addLine(to: CGPoint(x: x, y: y)) }
                    }
                }
                .stroke(Color.white.opacity(0.9), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))

                if let last = points.last {
                    let x = points.count > 1
                        ? geo.size.width * CGFloat(points.count - 1) / CGFloat(points.count - 1)
                        : geo.size.width
                    let normalized = (last.value - minV) / range
                    let y = chartTop + chartHeight - chartHeight * 0.65 * normalized - chartHeight * 0.15
                    Circle()
                        .fill(Color.white)
                        .frame(width: 8, height: 8)
                        .position(x: x, y: y)
                }

                HStack {
                    Text(firstLabel)
                    Spacer()
                    Text(lowLabel)
                }
                .font(.system(size: 8.5, weight: .regular, design: .monospaced))
                .tracking(1)
                .foregroundColor(.white.opacity(0.5))
                .offset(y: chartTop + chartHeight + 16)
            }
        }
        .frame(height: 76)
    }

    /// Bar (`EngineGraphics.mixBar`) plus Home's per-sport legend row underneath — the legend is
    /// Home-only chrome, not shared with WidgetKit's single "X.XH LOGGED" footer.
    private func mixBarSection(_ mix: [LoadMixSnapshot], totalHours: Double) -> some View {
        let activeMix = mix.filter { $0.hours > 0 }
        return VStack(alignment: .leading, spacing: 8) {
            EngineGraphics.mixBar(
                mix,
                totalHours: totalHours,
                segmentSpacing: 2,
                segmentCornerRadius: 2,
                minSegmentWidth: 2,
                outerClip: AnyShape(RoundedRectangle(cornerRadius: 4, style: .continuous)),
                showRemainder: true,
                remainderColor: Color.white.opacity(0.16)
            )
            .frame(height: 8)

            HStack(spacing: 14) {
                ForEach(activeMix) { item in
                    HStack(spacing: 5) {
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(WarmInstrument.color(hex: item.color))
                            .frame(width: 7, height: 7)
                        Text("\(item.shortLabel.uppercased()) \(String(format: "%.1f", item.hours))H")
                            .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                            .foregroundColor(.white.opacity(0.75))
                    }
                }
                Spacer(minLength: 0)
                Text(String(format: "%.1fH", totalHours))
                    .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                    .foregroundColor(.white.opacity(0.45))
            }
        }
    }
}
