import SwiftUI

/// Design tokens matching the Coach HQ website (coach-phelps.netlify.app).
///
/// Source of truth: `ui/client/src/lib/activities.ts` (SPORT_CONFIG) for sport colors, and
/// `shared/warm-instrument/tokens.json` (see `ios-token-mapping.md`) for the Warm Instrument
/// surface tokens below — warm paper background, warm ink foreground, 18pt card radius,
/// 10pt bold uppercase tracked section headers, sport-colored left bars, and a green accent
/// for progress/active states. The old neo-brutalist tokens (white cards, 12pt radius,
/// `brandRed`) are retired; see `WarmInstrument` for the load-only terracotta accent and the
/// rest of the Warm Instrument palette.
enum Theme {
    // MARK: - Appearance

    /// UserDefaults key for the Settings appearance toggle. The app defaults to
    /// light mode (the primary use case, matching the website); users can opt
    /// into dark mode from Settings → Appearance.
    static let darkModeKey = "appearanceDarkMode"

    // MARK: - Core palette

    /// Green accent for progress indicators and active states (#2d8a4e).
    static let accentGreen = Color(red: 0x2D / 255.0, green: 0x8A / 255.0, blue: 0x4E / 255.0)

    /// Orange used for "needs attention" indicators (badminton without scores).
    static let attentionOrange = Color(red: 0xF5 / 255.0, green: 0x9E / 255.0, blue: 0x0B / 255.0)

    /// Warm ink — text/foreground color, matches `WarmInstrument.ink` (site foreground).
    static let ink = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0xed / 255, green: 0xea / 255, blue: 0xe2 / 255, alpha: 1)
            : UIColor(red: 0x2b / 255, green: 0x2d / 255, blue: 0x29 / 255, alpha: 1)
    })

    /// Card background — warm paper in light mode, elevated dark in dark mode.
    static let cardBackground = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x21 / 255, green: 0x20 / 255, blue: 0x1c / 255, alpha: 1)
            : UIColor(red: 0xfb / 255, green: 0xf8 / 255, blue: 0xf1 / 255, alpha: 1)
    })

    /// Warm hairline card border (`rgba(84,76,65,.16)`, site `--wi-border`).
    static let cardBorder = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 84 / 255, green: 76 / 255, blue: 65 / 255, alpha: 0.35)
            : UIColor(red: 84 / 255, green: 76 / 255, blue: 65 / 255, alpha: 0.16)
    })

    /// Muted background — warm desk tone in light mode, elevated dark in dark mode.
    static let mutedBackground = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x16 / 255, green: 0x15 / 255, blue: 0x12 / 255, alpha: 1)
            : UIColor(red: 0xe8 / 255, green: 0xe2 / 255, blue: 0xd7 / 255, alpha: 1)
    })

    /// Card corner radius — Warm Instrument's `radius.cardIosPt` (18pt).
    static let cornerRadius: CGFloat = 18

    /// HR zone colors matching the website's HR_ZONE_LABELS (Z1 → Z5).
    static let hrZoneColors: [Color] = [
        Color(red: 0x93/255.0, green: 0xC5/255.0, blue: 0xFD/255.0), // Z1 light blue
        Color(red: 0x22/255.0, green: 0xC5/255.0, blue: 0x5E/255.0), // Z2 green
        Color(red: 0xEA/255.0, green: 0xB3/255.0, blue: 0x08/255.0), // Z3 yellow
        Color(red: 0xF9/255.0, green: 0x73/255.0, blue: 0x16/255.0), // Z4 orange
        Color(red: 0xEF/255.0, green: 0x44/255.0, blue: 0x44/255.0), // Z5 red
    ]

    /// Heart/vitals red — an alias onto the Z5 zone color so the Settings heart icon stays
    /// tokenized instead of a bare `.red` literal.
    static let heartRateColor = hrZoneColors[4]

    // MARK: - Sport colors (mirror SPORT_CONFIG in ui/client/src/lib/activities.ts)

    static let weightsColor = Color(red: 0x3B / 255.0, green: 0x4A / 255.0, blue: 0x6B / 255.0)   // WEIGHTS  #3b4a6b
    static let badmintonColor = Color(red: 0x2D / 255.0, green: 0x8A / 255.0, blue: 0x4E / 255.0) // BADMINTON #2d8a4e
    static let rideColor = Color(red: 0xC4 / 255.0, green: 0x7A / 255.0, blue: 0x20 / 255.0)      // RIDE     #c47a20
    static let runColor = Color(red: 0xC4 / 255.0, green: 0x40 / 255.0, blue: 0x20 / 255.0)       // RUN      #c44020
    static let otherColor = Color(red: 0x77 / 255.0, green: 0x77 / 255.0, blue: 0x77 / 255.0)     // OTHERS   #777

    // MARK: - Workout type colors (timer palette)

    static let foundationColor      = Color(red: 0x2B / 255.0, green: 0x6C / 255.0, blue: 0xB6 / 255.0) // blue
    static let calisthenicsTimerColor = Color(red: 0x2D / 255.0, green: 0x3A / 255.0, blue: 0x55 / 255.0) // dark blue-gray
    static let recoveryColor        = Color(red: 0x14 / 255.0, green: 0x82 / 255.0, blue: 0x7E / 255.0) // teal
    static let realignColor         = Color(red: 0x6B / 255.0, green: 0x21 / 255.0, blue: 0xA8 / 255.0) // purple

    static func workoutColor(for type: WorkoutType?) -> Color {
        switch type {
        case .foundation:    return foundationColor
        case .calisthenics:  return calisthenicsTimerColor
        case .recovery:      return recoveryColor
        case .realign:       return realignColor
        case nil:            return foundationColor
        }
    }

    static func workoutLabel(for type: WorkoutType?) -> String {
        switch type {
        case .foundation:   return "FOUNDATION"
        case .calisthenics: return "CALISTHENICS"
        case .recovery:     return "RECOVERY"
        case .realign:      return "REALIGN"
        case nil:           return "WORKOUT"
        }
    }

    /// SF Symbol name for a sport type — used in icon circles and grid cards.
    static func sportIcon(for sportType: String) -> String {
        switch sportType {
        case "Badminton":
            return "figure.badminton"
        case "WeightTraining", "Foundation", "TraditionalStrengthTraining", "FunctionalStrengthTraining":
            return "dumbbell.fill"
        case "Ride", "EBikeRide", "Cycling":
            return "figure.outdoor.cycle"
        case "Run", "Running":
            return "figure.run"
        default:
            return "figure.mixed.cardio"
        }
    }

    /// Maps a HealthKit/Strava sport type string to its website badge label + color.
    static func sportBadge(for sportType: String) -> (label: String, color: Color) {
        switch sportType {
        case "Badminton":
            return ("BADMINTON", badmintonColor)
        case "WeightTraining", "Foundation", "TraditionalStrengthTraining", "FunctionalStrengthTraining":
            return ("WEIGHTS", weightsColor)
        case "Ride", "EBikeRide", "Cycling":
            return ("RIDE", rideColor)
        case "Run", "Running":
            return ("RUN", runColor)
        default:
            return ("OTHER", otherColor)
        }
    }
}

// MARK: - Warm Instrument (Home surface)

/// Warm Instrument design tokens for the Home surface (Engine, commitments, quest, sessions,
/// plan, heatmap, coach's read, build phase, VO2, calories). Source of truth:
/// `shared/warm-instrument/tokens.json`; keep this block in sync per `ios-token-mapping.md`
/// until codegen exists. Card shell / ink / border here intentionally duplicate `Theme`'s
/// updated tokens by value (not by reference) so this enum reads standalone against the JSON
/// spec — see `Theme.cardBackground` / `Theme.ink` / `Theme.cardBorder` for the app-wide copy.
enum WarmInstrument {
    static let paper = Theme.cardBackground
    static let desk = Theme.mutedBackground
    static let surfaceMuted = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x27 / 255, green: 0x25 / 255, blue: 0x20 / 255, alpha: 1)
            : UIColor(red: 0xf3 / 255, green: 0xee / 255, blue: 0xe3 / 255, alpha: 1)
    })
    static let ink = Theme.ink
    static let inkMuted = Color(red: 0x75 / 255, green: 0x74 / 255, blue: 0x6b / 255)
    static let inkFaint = Color(red: 0x98 / 255, green: 0x99 / 255, blue: 0x8f / 255)

    /// Terracotta — reserved for LOAD only (Engine hero, commitment cube fills tied to load).
    /// Never use as a generic accent, CTA, or brand color.
    static let accent = Color(red: 0x7f / 255, green: 0x37 / 255, blue: 0x28 / 255)
    static let accentDark = Color(red: 0x65 / 255, green: 0x2b / 255, blue: 0x20 / 255)

    /// The one "something's wrong" color — cold indigo-grey. Never stack alarms.
    static let alarmBg = Color(red: 0xe4 / 255, green: 0xe4 / 255, blue: 0xec / 255)
    static let alarmFg = Color(red: 0x4b / 255, green: 0x55 / 255, blue: 0x78 / 255)

    static let border = Theme.cardBorder
    static let borderDashed = Color(red: 84 / 255, green: 76 / 255, blue: 65 / 255).opacity(0.35)
    static let headerRule = Color(red: 0xd8 / 255, green: 0xd2 / 255, blue: 0xc6 / 255)

    static let cardShadow = Color(red: 57 / 255, green: 52 / 255, blue: 42 / 255).opacity(0.08)
    static let engineShadow = Color(red: 101 / 255, green: 43 / 255, blue: 32 / 255).opacity(0.18)

    /// `radius.cardIosPt` — same value as `Theme.cornerRadius`, named here to match the JSON key.
    static let cardRadius: CGFloat = Theme.cornerRadius

    // MARK: Typography — Space Grotesk → SF Pro, Space Mono → SF Mono, Newsreader → serif italic
    // (bundling Newsreader is an open decision per ios/DESIGN.md; system serif italic for now).

    static func figures(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static func coachVoice(_ size: CGFloat) -> Font {
        .system(size: size, design: .serif).italic()
    }

    static func monoLabel(_ size: CGFloat = 10, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    /// Parses a `"#rrggbb"` hex string from a widget snapshot into a `Color`. Snapshot JSON
    /// always carries its own hex per item (commitment `accent`, engine `mix[].color`, etc.) —
    /// this is the only sport-color lookup the Warm Instrument surface needs; no separate
    /// hardcoded sport table is duplicated in Swift.
    static func color(hex: String) -> Color {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return inkFaint }
        return Color(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }

    /// Static sport palette mirroring `tokens.json`'s `sports.*.hex` — used only as a fallback
    /// where a snapshot item doesn't carry its own hex (most do; commitments/mix always do).
    static let sportColors: [WarmSportId: Color] = [
        .badminton: color(hex: "#315a4a"),
        .calisthenics: color(hex: "#4f587a"),
        .foundation: color(hex: "#6d7d4e"),
        .cycling: color(hex: "#a8702c"),
        .run: color(hex: "#c44020"),
        .strength: color(hex: "#111111"),
        .weightTraining: color(hex: "#3b4a6b"),
        .hike: color(hex: "#8b6f47"),
        .walk: color(hex: "#a8a29e"),
        .cricket: color(hex: "#2dd4bf"),
        .football: color(hex: "#e11d48"),
        .workout: color(hex: "#6b7280"),
        .swim: color(hex: "#0ea5e9"),
    ]

    static func sportColor(_ sport: WarmSportId) -> Color {
        sportColors[sport] ?? inkFaint
    }

    /// SF Symbol per Warm Instrument glyph kind — stand-in for the web's hand-drawn
    /// `ActivityGlyph` marks (see `ui/client/src/components/home-warm/ActivityGlyph.tsx`).
    /// Native SF Symbols, not ported SVGs, per the "views stay native" guardrail.
    static func sfSymbol(for glyph: ActivityGlyphKind) -> String {
        switch glyph {
        case .badminton: return "figure.badminton"
        case .cycling: return "figure.outdoor.cycle"
        case .calisthenics: return "figure.strengthtraining.functional"
        case .foundation: return "figure.flexibility"
        case .run: return "figure.run"
        case .recovery: return "moon.zzz.fill"
        case .strength, .weightTraining: return "dumbbell.fill"
        case .hike: return "figure.hiking"
        case .walk: return "figure.walk"
        case .cricket: return "figure.cricket"
        case .football: return "soccerball"
        case .workout: return "figure.mixed.cardio"
        case .swim: return "figure.pool.swim"
        case .other: return "figure.mixed.cardio"
        }
    }
}

// MARK: - Reusable styled components

/// All-caps tracked section header, e.g. "ACTIVITY FEED" — 10pt bold, 2px tracking, gray.
struct SectionHeader: View {
    let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 11, weight: .bold))
            .kerning(2)
            .foregroundColor(.secondary)
    }
}

/// Sport-type badge: filled color pill with white bold uppercase text, like the
/// website's filter buttons.
struct SportBadge: View {
    let sportType: String

    var body: some View {
        let badge = Theme.sportBadge(for: sportType)
        Text(badge.label)
            .font(.system(size: 9, weight: .bold))
            .kerning(1)
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(badge.color)
            .clipShape(Capsule())
    }
}

/// A single inline stat: value on top (semibold, monospaced digits), tiny gray
/// uppercase label below — matches the website's Duration | Cal | Avg HR | Peak row.
struct StatItem: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .foregroundColor(.primary)
            Text(label.uppercased())
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(.secondary)
        }
    }
}

/// Card container with white background, subtle light gray border, sharp corners.
struct ThemedCard<Content: View>: View {
    var padding: CGFloat = 10
    @ViewBuilder let content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(Theme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cornerRadius)
                    .stroke(Theme.cardBorder, lineWidth: 1)
            )
    }
}

/// Full-card press: opacity dimming, no scale (avoids border/edge clipping artifacts).
struct CardPressButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.82 : 1.0)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// List-row press: muted background flash, no scale (color bar must not clip).
struct RowPressButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay(configuration.isPressed ? Theme.mutedBackground.opacity(0.55) : Color.clear)
            .animation(.easeOut(duration: 0.08), value: configuration.isPressed)
    }
}

/// Primary action button — green fill, white semibold label, soft corners.
struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = Theme.accentGreen

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(fill.opacity(configuration.isPressed ? 0.8 : 1))
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
    }
}

/// Minimal screen header: large bold title on the system background with a
/// hairline divider underneath. Quiet, aesthetic, iOS-native.
struct BrandHeader: View {
    var title: String = "Coach HQ"
    var trailing: AnyView? = nil

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundColor(.primary)
                Spacer()
                if let trailing { trailing }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 10)

            Divider().opacity(0.5)
        }
        .background(Color(uiColor: .systemBackground))
    }
}

// MARK: - Haptics

/// Lightweight haptics helper — success/error notifications and selection ticks.
enum Haptics {
    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
}

// MARK: - Toast

/// Toast payload: message + severity. Identifiable by generation so repeated
/// toasts with the same text still re-trigger.
struct Toast: Equatable {
    enum Kind { case success, error, info }
    let kind: Kind
    let message: String
    var id = UUID()

    var icon: String {
        switch kind {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        case .info: return "info.circle.fill"
        }
    }

    var tint: Color {
        switch kind {
        case .success: return Theme.accentGreen
        case .error: return .red
        case .info: return Theme.ink
        }
    }
}

/// Overlay modifier that slides a compact toast down from the top, auto-hides
/// after a few seconds, and fires matching haptics.
struct ToastModifier: ViewModifier {
    @Binding var toast: Toast?

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let toast {
                HStack(spacing: 8) {
                    Image(systemName: toast.icon)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                    Text(toast.message)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(toast.tint)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .shadow(color: .black.opacity(0.15), radius: 8, y: 3)
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { withAnimation { self.toast = nil } }
                .task(id: toast.id) {
                    // Errors linger longer so they can actually be read.
                    let seconds: UInt64 = toast.kind == .error ? 6 : 2
                    try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                    withAnimation { self.toast = nil }
                }
            }
        }
        .animation(.spring(duration: 0.35), value: toast)
    }
}

extension View {
    /// Presents a toast at the top of this view whenever the binding is non-nil.
    func toast(_ toast: Binding<Toast?>) -> some View {
        modifier(ToastModifier(toast: toast))
    }
}

// MARK: - Skeleton loading

/// Redacts content and adds a gentle pulse while `isLoading` is true — used for
/// stats that arrive after the row/card is already on screen.
struct SkeletonModifier: ViewModifier {
    let isLoading: Bool
    @State private var pulsing = false

    func body(content: Content) -> some View {
        content
            .redacted(reason: isLoading ? .placeholder : [])
            .opacity(isLoading ? (pulsing ? 0.4 : 0.8) : 1)
            .animation(
                isLoading
                    ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                    : .default,
                value: pulsing
            )
            .onAppear { if isLoading { pulsing = true } }
            .onChange(of: isLoading) {
                pulsing = isLoading
            }
    }
}

extension View {
    /// Skeleton placeholder state: redacted + pulsing while loading.
    func skeleton(_ isLoading: Bool) -> some View {
        modifier(SkeletonModifier(isLoading: isLoading))
    }
}
