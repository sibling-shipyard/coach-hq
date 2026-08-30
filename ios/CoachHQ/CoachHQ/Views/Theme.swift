import SwiftUI

/// Design tokens matching the Coach HQ website (coach-phelps.netlify.app).
///
/// Sport / workout hexes come from `WITokens` (generated from
/// `shared/warm-instrument/tokens.json`). Warm Instrument surface tokens below — warm paper background, warm ink foreground, 18pt card radius,
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

    /// Legacy green accent — prefer `Theme.ink` for chrome and `WarmInstrument.accent` for load CTAs.
    /// Kept for sport-color parity (badminton) and deprecated reference views.
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

    static let hrZoneColors = WITokens.Zones.ramp

    /// Heart/vitals red — an alias onto the Z5 zone color so the Settings heart icon stays
    /// tokenized instead of a bare `.red` literal.
    static let heartRateColor = hrZoneColors[4]

    // MARK: - Sport colors (lookups into WITokens.Sports)

    static let weightsColor = WITokens.Sports.weightTraining
    static let badmintonColor = WITokens.Sports.badminton
    static let rideColor = WITokens.Sports.cycling
    static let runColor = WITokens.Sports.run
    static let otherColor = WITokens.Sports.other

    // MARK: - Workout type colors (lookups into WITokens.Workouts)

    static let foundationColor        = WITokens.Workouts.foundation
    static let calisthenicsTimerColor = WITokens.Workouts.calisthenics
    static let recoveryColor          = WITokens.Workouts.recovery
    static let realignColor           = WITokens.Workouts.realign
    static let strengthColor          = WITokens.Workouts.strength

    static func workoutColor(for type: WorkoutType?) -> Color {
        switch type {
        case .foundation:    return foundationColor
        case .calisthenics:  return calisthenicsTimerColor
        case .recovery:      return recoveryColor
        case .realign:       return realignColor
        case .strength:      return strengthColor
        // Same fallback web uses for an unrecognized type (WORKOUT_TYPE_ACCENT ?? RUST).
        case .other:         return calisthenicsTimerColor
        case nil:            return foundationColor
        }
    }

    static func workoutLabel(for type: WorkoutType?) -> String {
        switch type {
        case .foundation:        return "FOUNDATION"
        case .calisthenics:      return "CALISTHENICS"
        case .recovery:          return "RECOVERY"
        case .realign:           return "REALIGN"
        case .strength:          return "STRENGTH"
        case .other(let raw):    return raw.uppercased()
        case nil:                return "WORKOUT"
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

    /// Whether this sport supports in-app score entry via the ebadders pipeline.
    /// Only Badminton has structured score parsing + history tracking — all other
    /// sports never show the score section on ActivityDetailView.
    static func sportSupportsScoreEntry(for sportType: String) -> Bool {
        sportType == "Badminton"
    }

    // MARK: - Activity categories

    struct ActivityCategory {
        let code: String
        let label: String
    }

    /// Predefined category options for a sport type. Returns nil for sports with no taxonomy (Other).
    static func categoryOptions(for sportType: String) -> [ActivityCategory]? {
        switch sportType {
        case "Badminton":
            return [.init(code: "RNK", label: "Ranking"), .init(code: "TRN", label: "Training"), .init(code: "FRN", label: "Friendly")]
        case "WeightTraining", "Foundation", "TraditionalStrengthTraining", "FunctionalStrengthTraining":
            return [.init(code: "FDN", label: "Foundation"), .init(code: "HYP", label: "Hypertrophy"), .init(code: "STR", label: "Strength")]
        case "Run", "Running":
            return [.init(code: "EZY", label: "Easy"), .init(code: "TMP", label: "Tempo"), .init(code: "INT", label: "Intervals")]
        case "Ride", "EBikeRide", "Cycling":
            return [.init(code: "EZY", label: "Easy"), .init(code: "TMP", label: "Tempo"), .init(code: "CLB", label: "Climb")]
        default:
            return nil
        }
    }
}

// MARK: - Warm Instrument (Home surface)

/// Warm Instrument design tokens for the Home surface (Engine, commitments, quest, sessions,
/// plan, heatmap, coach's read, build phase, VO2, calories). Source of truth:
/// `shared/warm-instrument/tokens.json` via `WITokens`. Card shell / ink / border here intentionally duplicate `Theme`'s
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
    /// Coach Chat message pane — slightly warmer than desk (`Coach Chat Mobile.dc.html`).
    static let chatSurface = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x22 / 255, green: 0x21 / 255, blue: 0x1c / 255, alpha: 1)
            : UIColor(red: 0xf5 / 255, green: 0xf0 / 255, blue: 0xe6 / 255, alpha: 1)
    })
    static let ink = Theme.ink
    static let inkMuted = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x9e / 255, green: 0x9c / 255, blue: 0x93 / 255, alpha: 1)
            : UIColor(red: 0x75 / 255, green: 0x74 / 255, blue: 0x6b / 255, alpha: 1)
    })
    static let inkFaint = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x6e / 255, green: 0x6c / 255, blue: 0x65 / 255, alpha: 1)
            : UIColor(red: 0x98 / 255, green: 0x99 / 255, blue: 0x8f / 255, alpha: 1)
    })

    /// Terracotta — reserved for LOAD only (Engine hero, commitment cube fills tied to load).
    /// Never use as a generic accent, CTA, or brand color.
    static let accent = Color(red: 0x7f / 255, green: 0x37 / 255, blue: 0x28 / 255)
    static let accentDark = Color(red: 0x65 / 255, green: 0x2b / 255, blue: 0x20 / 255)

    /// The one "something's wrong" color — cold indigo-grey. Never stack alarms.
    static let alarmBg = Color(red: 0xe4 / 255, green: 0xe4 / 255, blue: 0xec / 255)
    static let alarmFg = Color(red: 0x4b / 255, green: 0x55 / 255, blue: 0x78 / 255)

    static let border = Theme.cardBorder
    static let borderDashed = Color(red: 84 / 255, green: 76 / 255, blue: 65 / 255).opacity(0.35)
    static let headerRule = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x3a / 255, green: 0x38 / 255, blue: 0x34 / 255, alpha: 1)
            : UIColor(red: 0xd8 / 255, green: 0xd2 / 255, blue: 0xc6 / 255, alpha: 1)
    })

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

    /// Sport color palette — lookups into `WITokens.Sports`.
    /// Reference these via `sportColor(_:)` at call sites so call sites stay stable.
    enum Sport {
        static let badminton      = WITokens.Sports.badminton
        static let run            = WITokens.Sports.run
        static let swim           = WITokens.Sports.swim
        static let tennis         = WITokens.Sports.tennis
        static let cycling        = WITokens.Sports.cycling
        static let calisthenics   = WITokens.Sports.calisthenics
        static let foundation     = WITokens.Sports.foundation
        static let strength       = WITokens.Sports.strength
        static let weightTraining = WITokens.Sports.weightTraining
        static let football       = WITokens.Sports.football
        static let cricket        = WITokens.Sports.cricket
        static let hike           = WITokens.Sports.hike
        static let walk           = WITokens.Sports.walk
        static let workout        = WITokens.Sports.workout
        static let other          = WITokens.Sports.other
    }

    /// Sport color lookup — keyed by `WarmSportId`, backed by `Sport` named constants.
    static let sportColors: [WarmSportId: Color] = [
        .badminton:     Sport.badminton,
        .calisthenics:  Sport.calisthenics,
        .foundation:    Sport.foundation,
        .cycling:       Sport.cycling,
        .run:           Sport.run,
        .strength:      Sport.strength,
        .weightTraining: Sport.weightTraining,
        .hike:          Sport.hike,
        .walk:          Sport.walk,
        .cricket:       Sport.cricket,
        .football:      Sport.football,
        .workout:       Sport.workout,
        .swim:          Sport.swim,
        .tennis:        Sport.tennis,
        .other:         Sport.other,
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
        case .tennis: return "figure.tennis"
        case .other: return "figure.mixed.cardio"
        }
    }
}

// MARK: - App navigation notifications

extension Notification.Name {
    /// Posted by WorkoutCompleteView "Talk to Coach" CTA — observed by MainTabView.
    static let navigateToChat = Notification.Name("coachHQ.navigateToChat")
    /// Posted by WorkoutCompleteView "Back to Home" CTA — observed by MainTabView.
    static let navigateToHome = Notification.Name("coachHQ.navigateToHome")
    /// Posted by WorkoutCompleteView "Talk to Coach" CTA — carries `workoutType` String in userInfo. Observed by CoachChatView.
    static let postWorkoutChatOpen = Notification.Name("coachHQ.postWorkoutChatOpen")
    /// Posted by UIWindow.motionEnded when the device is shaken — observed by MainTabView to open the rage report sheet.
    static let shakeGestureDetected = Notification.Name("coachHQ.shakeGestureDetected")
}

// MARK: - Shake gesture bridge

extension UIWindow {
    /// Bridges UIKit shake events into SwiftUI via a notification. UIWindow sits at the
    /// top of the responder chain so this fires even when a text field is first responder.
    override open func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        super.motionEnded(motion, with: event)
        guard motion == .motionShake else { return }
        NotificationCenter.default.post(name: .shakeGestureDetected, object: nil)
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

/// Primary action button — terracotta fill for load/save actions, white semibold label.
struct PrimaryButtonStyle: ButtonStyle {
    var fill: Color = WarmInstrument.accent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(fill.opacity(configuration.isPressed ? 0.8 : 1))
            .foregroundColor(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.15, bounce: 0), value: configuration.isPressed)
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

// MARK: - Warm Dialog

/// Warm Instrument modal — paper card on a dim scrim, primary + optional secondary actions.
/// Mirrors `wtx-dialog` in workout-timer-warm.css; shared by quit confirm, chat errors, etc.
struct WarmDialog: View {
    let title: String
    let message: String
    let primaryTitle: String
    let primaryAction: () -> Void
    var secondaryTitle: String? = nil
    var secondaryAction: (() -> Void)? = nil
    var primaryColor: Color? = nil
    /// Backdrop tap — defaults to secondary action, then primary.
    var onBackdropTap: (() -> Void)? = nil

    var body: some View {
        ZStack {
            Color(red: 43 / 255, green: 45 / 255, blue: 41 / 255)
                .opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture {
                    if let onBackdropTap {
                        onBackdropTap()
                    } else if let secondaryAction {
                        secondaryAction()
                    } else {
                        primaryAction()
                    }
                }

            VStack(alignment: .leading, spacing: 0) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Theme.ink)
                    .padding(.bottom, 8)

                Text(message)
                    .font(.system(size: 13.5))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .padding(.bottom, 20)

                HStack(spacing: 12) {
                    if let secondaryTitle, let secondaryAction {
                        WarmDialogActionButton(title: secondaryTitle, style: .secondary, action: secondaryAction)
                    }
                    WarmDialogActionButton(title: primaryTitle, style: .primary, primaryColor: primaryColor, action: primaryAction)
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
            .frame(maxWidth: 340)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(WarmInstrument.border, lineWidth: 1)
            )
            .shadow(color: Color(red: 43 / 255, green: 45 / 255, blue: 41 / 255).opacity(0.25), radius: 24, y: 12)
            .padding(.horizontal, 16)
        }
    }
}

struct WarmDialogActionButton: View {
    enum Style { case primary, secondary }

    let title: String
    let style: Style
    var primaryColor: Color? = nil
    let action: () -> Void

    private var resolvedPrimaryColor: Color { primaryColor ?? WarmInstrument.accent }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(style == .primary ? WarmInstrument.paper : Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(style == .primary ? resolvedPrimaryColor : WarmInstrument.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            style == .secondary ? WarmInstrument.headerRule : Color.clear,
                            lineWidth: 1
                        )
                )
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(WarmDialogPressStyle())
    }
}

private struct WarmDialogPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.15, bounce: 0), value: configuration.isPressed)
    }
}

// MARK: - Toast

/// Toast payload: message + severity. Identifiable by generation so repeated
/// toasts with the same text still re-trigger.
struct Toast: Equatable {
    enum Kind { case success, error, info, warning }
    let kind: Kind
    let message: String
    var id = UUID()

    var icon: String {
        switch kind {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        case .info: return "info.circle.fill"
        case .warning: return "exclamationmark.circle.fill"
        }
    }

    var backgroundFill: Color {
        switch kind {
        case .error: return WarmInstrument.alarmBg
        case .success, .info, .warning: return WarmInstrument.paper
        }
    }

    var foregroundColor: Color {
        switch kind {
        case .error: return WarmInstrument.alarmFg
        case .success: return WarmInstrument.ink
        case .info: return WarmInstrument.ink
        case .warning: return Theme.attentionOrange
        }
    }

    /// Errors stay until the athlete dismisses; other kinds auto-hide.
    var autoDismisses: Bool { kind != .error }
}

/// Overlay modifier that slides a compact toast down from the top. Errors persist
/// until tap or X; success/info/warning auto-hide after ~3.5s.
struct ToastModifier: ViewModifier {
    @Binding var toast: Toast?

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let toast {
                toastBanner(toast)
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { dismissToast() }
                    .task(id: toast.id) {
                        guard toast.autoDismisses else { return }
                        try? await Task.sleep(nanoseconds: 3_500_000_000)
                        dismissToast()
                    }
            }
        }
        .animation(.spring(duration: 0.35), value: toast)
    }

    private func dismissToast() {
        withAnimation { toast = nil }
    }

    @ViewBuilder
    private func toastBanner(_ toast: Toast) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: toast.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(toast.foregroundColor)

            Text(toast.message)
                .font(.system(size: 13, weight: toast.kind == .error ? .semibold : .medium))
                .foregroundColor(toast.foregroundColor)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)

            if toast.kind == .error {
                Button(action: dismissToast) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(toast.foregroundColor.opacity(0.85))
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(toast.backgroundFill)
        .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                .strokeBorder(
                    toast.kind == .error ? Color.clear : WarmInstrument.border,
                    lineWidth: 1
                )
        )
        .shadow(color: WarmInstrument.cardShadow, radius: 14, x: 0, y: 7)
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

// MARK: - Premium motion

/// Shared spring presets — tight, physical, never cartoon-bouncy.
enum PremiumMotion {
    static let state = Animation.spring(duration: 0.38, bounce: 0.15)
    static let dock = Animation.spring(duration: 0.38, bounce: 0.12)
    static let press = Animation.spring(duration: 0.18, bounce: 0)
    static let reveal = Animation.spring(duration: 0.35, bounce: 0.12)
    /// Hero stats after a network load — slow ease, no bounce (list→detail should feel calm).
    static let statsLoad = Animation.easeOut(duration: 0.65)
    /// ≤60ms per item — Design Philosophy stagger budget.
    static func staggerDelay(index: Int) -> Double { Double(index) * 0.055 }
    /// Onboarding hero cascade — slightly wider spacing so the sequence reads on cold launch.
    static func onboardingStaggerDelay(index: Int) -> Double { 0.08 + Double(index) * 0.07 }
    static let onboardingReveal = Animation.spring(duration: 0.48, bounce: 0.14)
}

/// Floating main-tab dock geometry — keep scroll clearance in sync with `MainTabView`.
enum WarmMainDockLayout {
    static let pillHeight: CGFloat = 58
    static let topPadding: CGFloat = 2
    /// Gap between the last scroll row and the dock pill.
    static let scrollBottomBreathingRoom: CGFloat = 16

    static var dockHeight: CGFloat { pillHeight + topPadding }

    /// Scroll content inset so the last row clears the floating dock (pill + shadow).
    static var scrollBottomClearance: CGFloat {
        dockHeight + scrollBottomBreathingRoom + 8
    }
}

extension View {
    /// Reserves space at the bottom of a tab-root `ScrollView` for the floating dock.
    func mainTabScrollBottomClearance() -> some View {
        contentMargins(.bottom, WarmMainDockLayout.scrollBottomClearance, for: .scrollContent)
    }
}

/// Fade + slide (optional scale) reveal for ledger rows, login hero, etc.
struct StaggerRevealModifier: ViewModifier {
    let delay: Double
    var offset: CGFloat = 4
    var scale: CGFloat = 1
    var animation: Animation = PremiumMotion.reveal
    @State private var visible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hiddenScale: CGFloat { scale < 1 ? scale : 1 }

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : offset)
            .scaleEffect(visible ? 1 : hiddenScale)
            .onAppear { playEntrance() }
            .onDisappear { visible = false }
    }

    private func playEntrance() {
        guard !visible else { return }
        if reduceMotion {
            visible = true
            return
        }
        Task { @MainActor in
            // Yield one frame so opacity-0 paints before we animate in.
            await Task.yield()
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
            }
            withAnimation(animation) {
                visible = true
            }
        }
    }
}

extension View {
    /// Cascading entrance — default 4pt lift, spring fade-in.
    func staggerReveal(
        delay: Double = 0,
        offset: CGFloat = 4,
        scale: CGFloat = 1,
        animation: Animation = PremiumMotion.reveal
    ) -> some View {
        modifier(StaggerRevealModifier(delay: delay, offset: offset, scale: scale, animation: animation))
    }

    /// Hero onboarding entrance — larger lift + scale pop, tuned for login/setup cold launch.
    func onboardingReveal(delay: Double = 0, index: Int = 0) -> some View {
        staggerReveal(
            delay: delay > 0 ? delay : PremiumMotion.onboardingStaggerDelay(index: index),
            offset: 14,
            scale: index == 0 ? 0.9 : 1,
            animation: PremiumMotion.onboardingReveal
        )
    }

    /// Swipe right from the leading edge to pop — matches hidden-nav-bar push screens.
    func edgeBackSwipe(enabled: Bool = true, action: @escaping () -> Void) -> some View {
        modifier(EdgeBackSwipeModifier(enabled: enabled, action: action))
    }
}

private struct EdgeBackSwipeModifier: ViewModifier {
    let enabled: Bool
    let action: () -> Void

    func body(content: Content) -> some View {
        if enabled {
            content.simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onEnded { value in
                        guard value.startLocation.x < 28,
                              value.translation.width > 56,
                              abs(value.translation.height) < 96 else { return }
                        Haptics.tap()
                        action()
                    }
            )
        } else {
            content
        }
    }
}
