import SwiftUI

/// A5-ios: three bands — today, this week, library — read-only over the same data the web
/// Workouts page reads (`ui/client/src/pages/Workouts.tsx`). Band selection itself is pure
/// and lives in `WorkoutsPageSelector`; this view just fetches what that selector needs and
/// renders whichever band it returns.
struct WorkoutListView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var workoutService: WorkoutService
    @State private var navigationPath: [Workout] = []
    @State private var selection = WorkoutsPageSelector.Selection(today: .none, week: nil)

    /// Re-fetch once repo discovery finishes (same pattern as WarmInstrumentHomeView).
    private var workoutFetchToken: String {
        [
            authManager.isSessionReady ? "ready" : "boot",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
    }

    private static let libraryOrder: [WorkoutType] = [.foundation, .strength, .calisthenics, .recovery, .realign]

    /// Library band: every template plus any standalone coach session with no matching
    /// template, grouped by workout_type. Today's plan lives in its own band above, not
    /// folded in here — unchanged from before A5-ios.
    private var groupedLibrary: [(type: WorkoutType, workouts: [Workout])] {
        let templateIds = Set(workoutService.templates.map(\.id))
        let standalone = workoutService.todaySessions.values.filter { !templateIds.contains($0.id) }
        var byType: [WorkoutType: [Workout]] = [:]
        for workout in workoutService.templates + standalone {
            byType[workout.workoutType, default: []].append(workout)
        }
        let ordered = Self.libraryOrder.compactMap { type -> (WorkoutType, [Workout])? in
            guard let entries = byType[type], !entries.isEmpty else { return nil }
            return (type, entries)
        }
        // Any workout_type not in libraryOrder (a future type the UI has no dedicated slot
        // for yet) still gets its own section instead of silently disappearing. Dictionary
        // iteration order is unspecified, so sort for a stable order across renders/launches.
        let leftover = byType.keys
            .filter { !Self.libraryOrder.contains($0) }
            .sorted { $0.rawValue < $1.rawValue }
            .compactMap { type in byType[type].map { (type, $0) } }
        return ordered + leftover
    }

    private var isEmpty: Bool {
        selection.today == .none && selection.week == nil && groupedLibrary.isEmpty
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    workoutsHeader

                    bandSection(label: "TODAY") {
                        TodayBandView(band: selection.today) { navigationPath.append($0) }
                    }

                    if let week = selection.week {
                        bandSection(label: "THIS WEEK") {
                            VStack(spacing: 6) {
                                ForEach(week, id: \.date) { row in
                                    WeekRowView(row: row)
                                }
                            }
                        }
                    }

                    bandSection(label: "LIBRARY") {
                        VStack(alignment: .leading, spacing: 20) {
                            ForEach(groupedLibrary, id: \.type) { group in
                                workoutGroup(type: group.type, workouts: group.workouts)
                            }
                        }
                    }
                }
            }
            .mainTabScrollBottomClearance()
            .scrollClipDisabled()
            .refreshable { await refreshAll() }
            .task(id: workoutFetchToken) {
                guard authManager.isSessionReady, authManager.repoFullName != nil else { return }
                await refreshAll()
            }
            .overlay {
                if workoutService.isLoading && workoutService.templates.isEmpty && isEmpty {
                    ProgressView()
                } else if let error = workoutService.fetchError, workoutService.templates.isEmpty {
                    // A fetch failure must never look identical to "you genuinely have no
                    // plan" — that false-empty state is what sent Skanda's real workouts
                    // missing on refresh.
                    errorState(error)
                } else if isEmpty {
                    emptyState
                }
            }
            .onChange(of: workoutService.fetchError) { _, newError in
                authManager.noteAPIError(newError)
            }
            .background(Theme.mutedBackground)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Workout.self) { workout in
                WorkoutOverviewView(workout: workout)
            }
        }
    }

    // MARK: - Fetch + selection

    private func refreshAll() async {
        await workoutService.fetchTemplates()
        await workoutService.fetchCurrentWeek()
        await workoutService.fetchAthleteTimezone()
        await recomputeSelection()
    }

    /// "Today" is always computed from the week's own timezone when live, or the athlete's
    /// known timezone otherwise — never the device's local zone.
    private func recomputeSelection() async {
        let plan = workoutService.currentWeek
        let availability = workoutService.currentWeekAvailability
        let live = (availability?.available ?? false) && plan != nil

        let todayZone: String
        if live, let plan {
            todayZone = plan.timezone
        } else {
            todayZone = workoutService.athleteTimezone ?? "UTC"
        }
        let today = dateString(for: Date(), inTimeZoneIdentifier: todayZone)

        await workoutService.fetchTodaySessions(forDate: today)

        selection = WorkoutsPageSelector.select(WorkoutsPageSelector.Input(
            currentWeek: plan,
            availability: availability,
            templates: workoutService.templates,
            sessionsForToday: workoutService.todaySessions,
            loggedActivities: SyncCache.load(),
            today: today
        ))
    }

    // MARK: - Bands

    @ViewBuilder
    private func bandSection<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label)
                .font(WarmInstrument.monoLabel(9))
                .kerning(1.2)
                .foregroundColor(WarmInstrument.inkFaint)
            content()
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "dumbbell")
                .font(.system(size: 36))
                .foregroundColor(WarmInstrument.inkFaint)
            Text("No workouts yet")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
            Text("Ask your coach to set up a training plan.")
                .font(.system(size: 14))
                .foregroundColor(WarmInstrument.inkMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 40)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36))
                .foregroundColor(WarmInstrument.inkFaint)
            Text("Couldn't load workouts")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
            Text(message)
                .font(.system(size: 14))
                .foregroundColor(WarmInstrument.inkMuted)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await refreshAll() }
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(WarmInstrument.ink)
            .padding(.top, 4)
        }
        .padding(.horizontal, 40)
    }

    private var workoutsHeader: some View {
        HStack(spacing: 10) {
            Text("WORKOUTS")
                .font(WarmInstrument.monoLabel(12))
                .tracking(1.4)
                .foregroundColor(WarmInstrument.ink)

            Spacer(minLength: 0)

            Text(Date().formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                .font(WarmInstrument.monoLabel(9))
                .tracking(1.0)
                .foregroundColor(WarmInstrument.inkFaint)
        }
        .padding(.horizontal, 22)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    private func workoutGroup(type: WorkoutType, workouts: [Workout]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Theme.workoutLabel(for: type))
                .font(WarmInstrument.monoLabel(11))
                .kerning(1.4)
                .foregroundColor(WarmInstrument.inkMuted)

            VStack(spacing: 12) {
                ForEach(workouts, id: \.id) { workout in
                    WarmWorkoutListCard(
                        workout: workout,
                        isSession: false,
                        isToday: false,
                        onTap: { navigationPath.append(workout) }
                    )
                }
            }
        }
    }
}

// MARK: - Today band

/// The only band with a timer button. Never labeled "Rest" for a day that has real content.
private struct TodayBandView: View {
    let band: WorkoutsPageSelector.TodayBand
    let onSelect: (Workout) -> Void

    var body: some View {
        switch band {
        case .runnable(let workout, let isSession, let done):
            TodayWorkoutHero(workout: workout, isSession: isSession, done: done) {
                onSelect(workout)
            }
        case .mention(let title, let durationMin):
            HStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(Theme.ink)
                if let durationMin {
                    Text("\(durationMin) min")
                        .font(WarmInstrument.figures(12))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
            }
        case .rest:
            Text("Rest")
                .font(.system(size: 15))
                .foregroundColor(WarmInstrument.inkMuted)
        case .none:
            Text("No live plan right now.")
                .font(.system(size: 15))
                .foregroundColor(WarmInstrument.inkFaint)
        }
    }
}

// MARK: - Week row

private struct WeekRowView: View {
    let row: WorkoutsPageSelector.WeekRow

    private var accent: Color {
        guard let discipline = row.discipline else { return WarmInstrument.inkFaint }
        return WarmInstrument.sportColor(discipline.asWarmSport)
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(Self.weekdayLabel(row.date))
                .font(WarmInstrument.monoLabel(10))
                .foregroundColor(row.isToday ? Theme.ink : WarmInstrument.inkFaint)
                .frame(width: 32, alignment: .leading)

            Circle()
                .fill(row.isFilled ? accent : WarmInstrument.inkFaint.opacity(0.25))
                .frame(width: 8, height: 8)

            Text(row.title ?? "—")
                .font(.system(size: 14, weight: row.isFilled ? .semibold : .regular))
                .foregroundColor(row.isFilled ? Theme.ink : WarmInstrument.inkFaint)
                .lineLimit(1)

            Spacer(minLength: 0)

            if let durationMin = row.durationMin {
                Text("\(durationMin)M")
                    .font(WarmInstrument.figures(11))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(row.isToday ? WarmInstrument.paper : Color.clear)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(row.isToday ? WarmInstrument.border : Color.clear, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    /// `row.date` is a bare `YYYY-MM-DD` calendar day with no time component, so the
    /// weekday is computed in UTC — matches web's `weekDateLabel`, never the device's zone.
    private static func weekdayLabel(_ date: String) -> String {
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let parser = DateFormatter()
        parser.calendar = utcCalendar
        parser.timeZone = utcCalendar.timeZone
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let parsed = parser.date(from: date) else { return date }

        let label = DateFormatter()
        label.calendar = utcCalendar
        label.timeZone = utcCalendar.timeZone
        label.locale = Locale(identifier: "en_US_POSIX")
        label.dateFormat = "EEE d"
        return label.string(from: parsed).uppercased()
    }
}

// MARK: - Workout card (mock 3a)

struct WarmWorkoutListCard: View {
    let workout: Workout
    let isSession: Bool
    let isToday: Bool
    let onTap: () -> Void

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }
    private var blockTags: WorkoutTimerWarm.BlockTags {
        WorkoutTimerWarm.deriveBlockTags(from: workout)
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center) {
                    HStack(spacing: 6) {
                        WarmWorkoutTypeBadge(
                            label: Theme.workoutLabel(for: workout.workoutType),
                            accent: accent
                        )
                        if isToday {
                            Text("TODAY")
                                .font(WarmInstrument.monoLabel(9))
                                .kerning(1)
                                .foregroundColor(WarmInstrument.paper)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Theme.ink)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        if isSession {
                            Text("COACH")
                                .font(WarmInstrument.monoLabel(9))
                                .kerning(1)
                                .foregroundColor(WarmInstrument.sportColor(.badminton))
                        }
                    }
                    Spacer()
                    Text("→")
                        .font(.system(size: 15))
                        .foregroundColor(WorkoutTimerWarm.numberFaint)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(workout.title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    Text(workout.subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                }

                HStack(spacing: 12) {
                    Text("\(workout.estimatedDurationMins)M")
                    Text("\(workout.exerciseCount) EX")
                    Text("\(workout.setCount) SETS")
                    if !workout.location.isEmpty {
                        Text(workout.location.uppercased())
                    }
                }
                .font(WarmInstrument.figures(10))
                .foregroundColor(WarmInstrument.inkFaint)
                .lineLimit(1)

                if !blockTags.tags.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(blockTags.tags.prefix(3), id: \.self) { tag in
                            tagChip(tag)
                        }
                        let hidden = max(0, blockTags.tags.count - 3) + blockTags.overflow
                        if hidden > 0 {
                            tagChip("+\(hidden)")
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WarmInstrument.paper)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(accent)
                    .frame(height: 3)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(WarmInstrument.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: WarmInstrument.cardShadow, radius: 8, y: 4)
        }
        .buttonStyle(CardPressButtonStyle())
    }

    private func tagChip(_ text: String) -> some View {
        Text(text.uppercased())
            .font(WarmInstrument.monoLabel(9))
            .foregroundColor(WarmInstrument.inkMuted)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .stroke(WorkoutTimerWarm.listItemBorder, lineWidth: 1)
            )
    }
}

// MARK: - Simple flow layout for tag chips

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var positions: [CGPoint] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}

// MARK: - Today workout hero card

/// Prominent full-width card shown at the top of Workouts when Coach has a session
/// prepared for today. Tapping navigates to WorkoutOverview.
struct TodayWorkoutHero: View {
    let workout: Workout
    /// True when this is a coach-adjusted session file rather than the base template.
    var isSession: Bool = false
    var done: Bool = false
    let onTap: () -> Void

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 0) {
                // Accent top strip + TODAY/DONE badge
                HStack(spacing: 8) {
                    Text(done ? "DONE" : "TODAY")
                        .font(WarmInstrument.monoLabel(9))
                        .kerning(1.2)
                        .foregroundColor(WarmInstrument.paper)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(done ? WarmInstrument.inkFaint : accent)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                    Text(Theme.workoutLabel(for: workout.workoutType))
                        .font(WarmInstrument.monoLabel(9))
                        .kerning(1.1)
                        .foregroundColor(accent)

                    if isSession {
                        Text("COACH")
                            .font(WarmInstrument.monoLabel(9))
                            .kerning(1)
                            .foregroundColor(WarmInstrument.sportColor(.badminton))
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
                .padding(.horizontal, 18)
                .padding(.top, 16)
                .padding(.bottom, 12)

                // Title + subtitle
                VStack(alignment: .leading, spacing: 4) {
                    Text(workout.title)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(Theme.ink)
                        .lineLimit(2)
                    Text(workout.subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                }
                .padding(.horizontal, 18)

                // Stats row
                HStack(spacing: 14) {
                    Label("\(workout.estimatedDurationMins)M", systemImage: "clock")
                    Label("\(workout.exerciseCount) EX", systemImage: "figure.strengthtraining.functional")
                    Label("\(workout.setCount) SETS", systemImage: "repeat")
                }
                .font(WarmInstrument.figures(10))
                .foregroundColor(WarmInstrument.inkFaint)
                .labelStyle(.titleAndIcon)
                .padding(.horizontal, 18)
                .padding(.top, 10)
                .padding(.bottom, 18)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(accent.opacity(0.25), lineWidth: 1.5)
            )
            .shadow(color: accent.opacity(0.12), radius: 16, x: 0, y: 6)
        }
        .buttonStyle(CardPressButtonStyle())
    }
}
