import SwiftUI

/// Shared Warm Instrument atoms — build once, reuse everywhere, per the Design Philosophy's
/// "Shared atoms" note: sport icon set, mono-label style, session row, sport chip, hairline
/// progress underline, and the card shell. See `ui/docs/reference-interactions/Widget Design
/// Philosophy.md` for the spec these mirror.

// MARK: - WarmCard

/// The Warm Instrument card shell — paper surface, warm hairline border, soft shadow, 18pt
/// radius. `dashed` marks a card as provisional (the weekly plan's "nothing here has been
/// earned yet" treatment).
struct WarmCard<Content: View>: View {
    var padding: CGFloat = 16
    var dashed: Bool = false
    var fill: Color = WarmInstrument.paper
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(fill)
            .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                    .strokeBorder(
                        dashed ? WarmInstrument.borderDashed : WarmInstrument.border,
                        style: dashed ? StrokeStyle(lineWidth: 1, dash: [5, 4]) : StrokeStyle(lineWidth: 1)
                    )
            )
            .shadow(color: WarmInstrument.cardShadow, radius: 14, x: 0, y: 7)
    }
}

/// A card's small uppercase kicker row — `"ENGINE · WK 30"` style label, optional trailing value.
struct CardKicker: View {
    let label: String
    var trailing: String? = nil
    var trailingColor: Color = WarmInstrument.ink

    var body: some View {
        HStack {
            MonoLabel(label)
            Spacer()
            if let trailing {
                MonoLabel(trailing, color: trailingColor)
            }
        }
    }
}

// MARK: - MonoLabel

/// Small tracked uppercase monospace label — `wi-card-label` / `wi-card-kicker` equivalent.
/// 9–11px Space Mono on web; SF Mono here via `.design(.monospaced)`.
struct MonoLabel: View {
    let text: String
    var size: CGFloat = 10
    var weight: Font.Weight = .bold
    var color: Color = WarmInstrument.inkMuted
    var tracking: CGFloat = 1.1

    init(
        _ text: String,
        size: CGFloat = 10,
        weight: Font.Weight = .bold,
        color: Color = WarmInstrument.inkMuted,
        tracking: CGFloat = 1.1
    ) {
        self.text = text
        self.size = size
        self.weight = weight
        self.color = color
        self.tracking = tracking
    }

    var body: some View {
        Text(text.uppercased())
            .font(WarmInstrument.monoLabel(size, weight: weight))
            .tracking(tracking)
            .foregroundColor(color)
    }
}

// MARK: - Hairline progress underline

/// The "kept, not celebrated" progress underline shared by cubes, quests, and the plan
/// projection — a quiet hairline, not a chunky progress bar.
struct HairlineProgress: View {
    /// 0...1
    var fraction: Double
    var tint: Color = WarmInstrument.accent
    var track: Color = WarmInstrument.border
    var height: CGFloat = 3

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule()
                    .fill(tint)
                    .frame(width: geo.size.width * max(0, min(1, fraction)))
            }
        }
        .frame(height: height)
    }
}

// MARK: - SportChip

/// Sport icon in sport color on a 10% tint background — shared by the weekly plan slots and
/// the training heatmap legend. Never redesign this per surface; only the size changes.
struct SportChip: View {
    let glyph: ActivityGlyphKind
    let color: Color
    var size: CGFloat = 30
    var label: String? = nil

    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                    .fill(color.opacity(0.1))
                Image(systemName: WarmInstrument.sfSymbol(for: glyph))
                    .font(.system(size: size * 0.46, weight: .semibold))
                    .foregroundColor(color)
            }
            .frame(width: size, height: size)

            if let label {
                MonoLabel(label, size: 9, color: color)
            }
        }
    }
}

// MARK: - SportStripCell

/// One column in the mobile commitment quartet strip — glyph, mono numeral, ruled scale,
/// micro caption. Matches `Warm Instrument Mobile.dc.html` phone 1 sport strip.
struct SportStripCell: View {
    let commitment: CommitmentSnapshot
    var showingRanked: Bool = false
    var onToggle: (() -> Void)? = nil

    private var accent: Color { WarmInstrument.color(hex: commitment.accent) }
    private var isAlarm: Bool { commitment.alarm == true }

    private var progressFraction: Double {
        if let progress = commitment.progress {
            return max(0, min(1, progress / 100))
        }
        return commitment.value > 0 ? 1 : 0
    }

    private var recordCaption: String {
        if commitment.id == "badminton" {
            return showingRanked ? (commitment.rankedRecord ?? commitment.note) : (commitment.allRecord ?? commitment.note)
        }
        return commitment.note
    }

    private var statusCaption: String {
        if commitment.id == "badminton" {
            return showingRanked ? "RKD" : "ALL"
        }
        return commitment.status
    }

    private func number(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: WarmInstrument.sfSymbol(for: commitment.glyph))
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(isAlarm ? WarmInstrument.alarmFg : accent)

            Text(number(commitment.value))
                .font(WarmInstrument.figures(22, weight: .bold))
                .foregroundColor(isAlarm ? WarmInstrument.alarmFg : WarmInstrument.ink)
                .contentTransition(.numericText())

            VStack(alignment: .leading, spacing: 6) {
                HairlineProgress(
                    fraction: progressFraction,
                    tint: isAlarm ? WarmInstrument.alarmFg.opacity(0.35) : accent,
                    track: isAlarm ? WarmInstrument.alarmFg.opacity(0.3) : WarmInstrument.headerRule,
                    height: 1
                )

                HStack(spacing: 4) {
                    if isAlarm {
                        Text((commitment.note.isEmpty ? commitment.status : commitment.note).uppercased())
                            .font(WarmInstrument.monoLabel(8.5, weight: .bold))
                            .tracking(0.3)
                            .foregroundColor(WarmInstrument.alarmFg)
                            .lineLimit(1)
                    } else {
                        Text(recordCaption.uppercased())
                            .font(WarmInstrument.monoLabel(8.5, weight: .regular))
                            .tracking(0.3)
                            .foregroundColor(WarmInstrument.inkMuted)
                            .lineLimit(1)
                        if commitment.id == "badminton" {
                            Text(statusCaption)
                                .font(WarmInstrument.monoLabel(8.5, weight: .bold))
                                .tracking(0.3)
                                .foregroundColor(accent)
                        } else if !commitment.status.isEmpty {
                            Text(commitment.status.uppercased())
                                .font(WarmInstrument.monoLabel(8.5, weight: .bold))
                                .tracking(0.3)
                                .foregroundColor(WarmInstrument.inkMuted)
                                .lineLimit(1)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(isAlarm ? WarmInstrument.alarmBg : Color.clear)
        .contentShape(Rectangle())
        .onTapGesture {
            guard let onToggle else { return }
            Haptics.tap()
            onToggle()
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(onToggle != nil ? .isButton : [])
        .accessibilityLabel("\(commitment.label): \(number(commitment.value))")
    }
}

// MARK: - SportCube

/// One cube per sport commitment — icon top-left, count top-right, hairline underline +
/// caption bottom. The atom is identical at every scale (single cube on iOS S, quartet strip
/// on M) — never redesign it per platform.
struct SportCube: View {
    let commitment: CommitmentSnapshot

    private var accent: Color { WarmInstrument.color(hex: commitment.accent) }
    private var isAlarm: Bool { commitment.alarm == true }

    private var progressFraction: Double {
        if let progress = commitment.progress {
            return max(0, min(1, progress / 100))
        }
        return commitment.value > 0 ? 1 : 0
    }

    private func number(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                Image(systemName: WarmInstrument.sfSymbol(for: commitment.glyph))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(accent)
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(number(commitment.value))
                        .font(WarmInstrument.figures(20, weight: .bold))
                        .foregroundColor(WarmInstrument.ink)
                    if let target = commitment.target {
                        Text("/\(number(target))")
                            .font(WarmInstrument.figures(12, weight: .semibold))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                }
                .contentTransition(.numericText())
            }

            VStack(alignment: .leading, spacing: 6) {
                if isAlarm {
                    Text("The bar is cold.")
                        .font(WarmInstrument.coachVoice(11))
                        .foregroundColor(WarmInstrument.alarmFg)
                }

                HairlineProgress(fraction: progressFraction, tint: accent)

                HStack {
                    MonoLabel(commitment.note.isEmpty ? "—" : commitment.note, size: 9)
                    Spacer()
                    if !commitment.status.isEmpty {
                        MonoLabel(commitment.status, size: 9, color: accent)
                    }
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isAlarm ? WarmInstrument.alarmBg : WarmInstrument.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius * 0.75, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WarmInstrument.cardRadius * 0.75, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(commitment.label): \(number(commitment.value))\(commitment.target.map { "/\(number($0))" } ?? "")\(isAlarm ? ", the bar is cold" : "")")
    }
}

// MARK: - SessionRow

/// The ledger row — date · sport tick · title · +load. "Every entry earns its load — nothing
/// invented." One component everywhere; platforms only change row count and density.
struct SessionRow: View {
    let session: RecentSessionSnapshot
    /// Mobile home recent list — date · vein · title · load (no detail line).
    var compact: Bool = false

    private var sportColor: Color { WarmInstrument.sportColor(session.sport) }

    var body: some View {
        HStack(spacing: 10) {
            MonoLabel(session.dateLabel, size: 9, color: WarmInstrument.inkFaint, tracking: 0.6)
                .frame(width: compact ? 42 : 46, alignment: .leading)

            RoundedRectangle(cornerRadius: 2)
                .fill(sportColor)
                .frame(width: 3, height: compact ? 22 : 30)

            if compact {
                Text(session.title)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text(session.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(1)
                    Text(session.detail)
                        .font(.system(size: 11))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: compact ? 0 : 8)

            Text(session.load.map { "+\(Int($0))" } ?? "—")
                .font(WarmInstrument.figures(compact ? 10 : 14, weight: .bold))
                .foregroundColor(sportColor)
                .contentTransition(.numericText())
        }
        .padding(.vertical, compact ? 10 : 8)
    }
}

// MARK: - Warm tab bar

/// Minimal icon-only bottom nav — paper surface, hairline top rule, ink selected / faint idle.
/// Terracotta stays off chrome; reserved for load CTAs inside screens.
struct WarmTabBar: View {
    @Binding var selection: AppTab

    var body: some View {
        HStack(spacing: 0) {
            tabItem(.home, outline: "house", filled: "house.fill", label: "Home")
            tabItem(.workouts, outline: "dumbbell", filled: "dumbbell.fill", label: "Workouts")
            tabItem(.more, outline: "ellipsis.circle", filled: "ellipsis.circle.fill", label: "More")
        }
        .padding(.horizontal, 28)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(WarmInstrument.paper)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(WarmInstrument.headerRule)
                .frame(height: 1)
        }
    }

    private func tabItem(_ tab: AppTab, outline: String, filled: String, label: String) -> some View {
        let selected = selection == tab
        return Button {
            guard selection != tab else { return }
            Haptics.tap()
            withAnimation(.spring(duration: 0.2, bounce: 0)) {
                selection = tab
            }
        } label: {
            Image(systemName: selected ? filled : outline)
                .font(.system(size: 21, weight: selected ? .semibold : .regular))
                .foregroundColor(selected ? WarmInstrument.ink : WarmInstrument.inkFaint)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
