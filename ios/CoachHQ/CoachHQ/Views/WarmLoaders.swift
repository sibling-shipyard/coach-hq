import SwiftUI

/// Physics for the page-wait stamp. `t` is 0...1 over one loop (out and back).
enum WavePhysics {
    static let barCount = 9
    static let barWidth: CGFloat = 5
    static let barGap: CGFloat = 6
    static let barPitch: CGFloat = barWidth + barGap
    static let bounceCount = 2.0
    static let maxBounce: CGFloat = 12
    static let baseBarHeight: CGFloat = 10
    static let wavePeak: CGFloat = 16
    static let minBarHeight: CGFloat = 4
    static let ballDiameter: CGFloat = 8
    /// Skip the end bars so the circle never kisses the canvas edge.
    static let travelInset = 1
    static let loopDuration: TimeInterval = 5.2
    /// Frozen Reduce Motion pose — outbound, mid-hop.
    static let reducedMotionT = 0.125

    static var rowWidth: CGFloat { CGFloat(barCount - 1) * barPitch + barWidth }
    static var xPad: CGFloat { (ballDiameter - barWidth) / 2 + 2 }
    static var canvasWidth: CGFloat { rowWidth + 2 * xPad }
    static var canvasHeight: CGFloat { baseBarHeight + wavePeak + maxBounce + ballDiameter + 4 }
    static var travelStartIndex: Double { Double(travelInset) }
    static var travelEndIndex: Double { Double(barCount - 1 - travelInset) }

    struct Frame: Equatable {
        var ballX: CGFloat
        var ballY: CGFloat
        var bounce: CGFloat
        var bars: [Bar]
    }

    struct Bar: Equatable {
        var height: CGFloat
        var wave: CGFloat
    }

    static func frame(at t: Double) -> Frame {
        let clamped = min(1, max(0, t))
        // Cosine ping-pong: zero velocity at both ends and the far turn.
        let xFrac = 0.5 - 0.5 * cos(clamped * 2 * .pi)
        let ballIndex = travelStartIndex + xFrac * (travelEndIndex - travelStartIndex)

        // Phase 0.5 so cosine hang at the ends is the hop apex, not a landing on the bar.
        let bounceF = (xFrac * bounceCount + 0.5).truncatingRemainder(dividingBy: 1)
        let bounceH = sin(bounceF * .pi) * sin(bounceF * .pi)
        let ballY = (baseBarHeight + wavePeak + 1.5) + CGFloat(bounceH) * maxBounce

        let bars: [Bar] = (0..<barCount).map { i in
            let dist = abs(Double(i) - ballIndex)
            let wave = exp(-0.5 * pow(dist / 1.7, 2))
            let height = max(minBarHeight, baseBarHeight + CGFloat(wave) * wavePeak)
            return Bar(height: height, wave: wave)
        }

        return Frame(
            ballX: CGFloat(ballIndex) * barPitch,
            ballY: ballY,
            bounce: CGFloat(bounceH),
            bars: bars
        )
    }
}

/// Page wait — pebble hopping the bars. Ink on desk, never terracotta.
struct WarmWaveLoader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = reduceMotion
                ? WavePhysics.reducedMotionT
                : context.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: WavePhysics.loopDuration)
                    / WavePhysics.loopDuration
            Canvas { gfx, size in
                draw(WavePhysics.frame(at: t), into: gfx, size: size)
            }
        }
        .frame(width: WavePhysics.canvasWidth, height: WavePhysics.canvasHeight)
        .accessibilityHidden(true)
    }

    private func draw(_ frame: WavePhysics.Frame, into gfx: GraphicsContext, size: CGSize) {
        let ground = size.height
        let xPad = WavePhysics.xPad
        for (i, bar) in frame.bars.enumerated() {
            let x = xPad + CGFloat(i) * WavePhysics.barPitch
            let rect = CGRect(
                x: x,
                y: ground - bar.height,
                width: WavePhysics.barWidth,
                height: bar.height
            )
            gfx.fill(
                Path(roundedRect: rect, cornerRadius: WavePhysics.barWidth / 2),
                with: .color(barColor(bar.wave))
            )
        }

        let cx = xPad + frame.ballX + WavePhysics.barWidth / 2
        let d = WavePhysics.ballDiameter
        let ball = CGRect(
            x: cx - d / 2,
            y: ground - frame.ballY - d,
            width: d,
            height: d
        )
        gfx.fill(Path(ellipseIn: ball), with: .color(WarmInstrument.ink))
    }

    private func barColor(_ wave: CGFloat) -> Color {
        WarmInstrument.inkFaint.mix(with: WarmInstrument.ink, by: wave)
    }
}

/// Inline wait — three equalizer bars. Default 24pt, sits next to copy.
struct WarmSignalLoader: View {
    var size: CGFloat = 24
    var color: Color = WarmInstrument.ink
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .center, spacing: size * 0.12) {
                ForEach(0..<3, id: \.self) { i in
                    Capsule()
                        .fill(color)
                        .frame(width: max(2, size * 0.16), height: barHeight(index: i, time: t))
                }
            }
            .frame(width: size, height: size)
        }
        .accessibilityHidden(true)
    }

    private func barHeight(index: Int, time: TimeInterval) -> CGFloat {
        let minH = size * 0.28
        let maxH = size * 0.92
        if reduceMotion {
            let frozen = [0.45, 0.82, 0.58]
            return minH + (maxH - minH) * frozen[index]
        }
        let phase = Double(index) * 0.42
        let wave = 0.5 + 0.5 * sin(time * 6.2 + phase)
        return minH + (maxH - minH) * wave
    }
}

/// Centred page wait with optional caption. Replaces a full-screen `ProgressView`.
struct WarmPageWait: View {
    var caption: String? = nil

    var body: some View {
        VStack(spacing: 12) {
            WarmWaveLoader()
            if let caption {
                Text(caption)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(WarmInstrument.inkFaint)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(caption ?? "Loading")
    }
}

private extension Color {
    func mix(with other: Color, by amount: CGFloat) -> Color {
        let t = min(1, max(0, amount))
        return Color(uiColor: UIColor { trait in
            var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
            var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
            UIColor(self).resolvedColor(with: trait).getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
            UIColor(other).resolvedColor(with: trait).getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
            return UIColor(
                red: r1 + (r2 - r1) * t,
                green: g1 + (g2 - g1) * t,
                blue: b1 + (b2 - b1) * t,
                alpha: a1 + (a2 - a1) * t
            )
        })
    }
}

// MARK: - Buttons

/// Terracotta or ink primary. Signal sits beside the label; the pair is centred.
struct WarmPrimary: View {
    enum Size {
        case regular
        case compact

        var height: CGFloat { self == .regular ? 54 : 30 }
        var signal: CGFloat { self == .regular ? 18 : 16 }
        var font: Font {
            self == .regular
                ? .system(size: 15, weight: .semibold)
                : .system(size: 12, weight: .semibold)
        }
        var radius: CGFloat { self == .regular ? WarmInstrument.cardRadius : 15 }
        var isCapsule: Bool { self == .compact }
    }

    enum Icon {
        case none
        case system(String)
        case asset(String)
    }

    let title: String
    var isBusy: Bool = false
    var fill: Color = WarmInstrument.accent
    var size: Size = .regular
    var icon: Icon = .none
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isBusy {
                    WarmSignalLoader(size: size.signal, color: WarmInstrument.onAccent)
                } else {
                    idleIcon
                }
                if !title.isEmpty {
                    Text(title)
                        .font(size.font)
                        .contentTransition(.opacity)
                }
            }
            .foregroundColor(WarmInstrument.onAccent)
            .frame(maxWidth: size.isCapsule ? nil : .infinity)
            .frame(minWidth: size.isCapsule ? 64 : nil)
            .frame(height: size.height)
            .padding(.horizontal, size.isCapsule ? 12 : 0)
            .background(fill)
            .clipShape(
                RoundedRectangle(cornerRadius: size.isCapsule ? size.height / 2 : size.radius, style: .continuous)
            )
        }
        .buttonStyle(WarmPrimaryPressStyle(shadowed: !size.isCapsule, shadowColor: fill))
    }

    @ViewBuilder
    private var idleIcon: some View {
        switch icon {
        case .none:
            EmptyView()
        case .system(let name):
            Image(systemName: name)
                .font(.system(size: size.signal - 5, weight: .semibold))
                .frame(width: size.signal, height: size.signal)
        case .asset(let name):
            Image(name)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: size.signal, height: size.signal)
        }
    }
}

/// Paper secondary. Same 54pt rhythm as `WarmPrimary`.
struct WarmSecondary: View {
    let title: String
    var isBusy: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isBusy {
                    WarmSignalLoader(size: 18, color: WarmInstrument.ink)
                }
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundColor(WarmInstrument.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                    .strokeBorder(WarmInstrument.border, lineWidth: 1)
            )
        }
        .buttonStyle(WarmPrimaryPressStyle(shadowed: false, shadowColor: .clear))
    }
}

private struct WarmPrimaryPressStyle: ButtonStyle {
    var shadowed: Bool
    var shadowColor: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .shadow(
                color: shadowed ? shadowColor.opacity(configuration.isPressed ? 0.18 : 0.28) : .clear,
                radius: 8,
                y: 4
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.15, bounce: 0), value: configuration.isPressed)
    }
}

/// Desk gallery: Wave, Signal, and the shared busy button.
struct WarmLoaderGalleryView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Wait language")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(WarmInstrument.ink)
                    Text("NOW is shipping. NEXT is Wave + Signal.")
                        .font(.system(size: 13))
                        .foregroundStyle(WarmInstrument.inkMuted)
                }

                compareSection("PAGE WAIT") {
                    labeled("NOW") {
                        VStack(spacing: 12) {
                            ProgressView()
                                .tint(WarmInstrument.inkMuted)
                                .controlSize(.regular)
                            Text("Loading Coach…")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(WarmInstrument.inkFaint)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 88)
                    }
                    labeled("NEXT") {
                        WarmPageWait(caption: "Loading Coach…")
                            .frame(maxWidth: .infinity)
                            .frame(height: 88)
                    }
                }

                compareSection("INLINE") {
                    HStack(alignment: .top, spacing: 10) {
                        labeled("NOW") {
                            inlineCard {
                                ProgressView()
                                    .tint(WarmInstrument.inkMuted)
                                    .controlSize(.small)
                                Text("Saving…")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(WarmInstrument.ink)
                            }
                        }
                        labeled("NEXT") {
                            inlineCard {
                                WarmSignalLoader(size: 24)
                                Text("Saving…")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(WarmInstrument.ink)
                            }
                        }
                    }
                }

                compareSection("PRIMARY ACTION") {
                    labeled("IDLE") {
                        WarmPrimary(title: "Save & Sync", action: {})
                    }
                    labeled("BUSY") {
                        WarmPrimary(title: "Saving…", isBusy: true, action: {})
                    }
                    labeled("INK · AUTH") {
                        WarmPrimary(
                            title: "Signing in…",
                            isBusy: true,
                            fill: Theme.ink,
                            icon: .asset("GitHubMark"),
                            action: {}
                        )
                    }
                }

                compareSection("CHAT REPLY") {
                    labeled("NOW · bouncing dots") {
                        CoachChatThinkingBubble()
                    }
                    labeled("NEXT · same copy, Signal") {
                        HStack(spacing: 10) {
                            WarmSignalLoader(size: 22, color: WarmInstrument.inkFaint)
                            Text("Coach is thinking…")
                                .font(.system(size: 13))
                                .foregroundStyle(WarmInstrument.inkMuted)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 14)
                        .background(WarmInstrument.surfaceMuted)
                        .clipShape(
                            UnevenRoundedRectangle(
                                topLeadingRadius: 18,
                                bottomLeadingRadius: 18,
                                bottomTrailingRadius: 18,
                                topTrailingRadius: 4,
                                style: .continuous
                            )
                        )
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 40)
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
    }

    private func compareSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            MonoLabel(title, size: 10, tracking: 1.4)
            content()
        }
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(WarmInstrument.inkFaint)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func inlineCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 10) {
            content()
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
    }
}

#Preview("Wave") {
    WarmPageWait(caption: "Loading Coach…")
        .background(WarmInstrument.desk)
}

#Preview("Signal") {
    HStack(spacing: 8) {
        WarmSignalLoader(size: 24)
        Text("Saving…")
    }
    .padding()
    .background(WarmInstrument.desk)
}

#Preview("Gallery") {
    WarmLoaderGalleryView()
}
