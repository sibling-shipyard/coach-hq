import SwiftUI

struct WorkoutListView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var workoutService: WorkoutService
    @EnvironmentObject var widgetStore: WidgetSnapshotStore
    @State private var navigationPath: [Workout] = []

    /// Re-fetch once repo discovery finishes (same pattern as WarmInstrumentHomeView).
    private var workoutFetchToken: String {
        [
            authManager.isSessionReady ? "ready" : "boot",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
    }

    private var allWorkouts: [(workout: Workout, isSession: Bool)] {
        let templateIds = Set(workoutService.templates.map(\.id))
        let templateEntries: [(workout: Workout, isSession: Bool)] = workoutService.templates.compactMap { template in
            guard let w = workoutService.displayWorkout(for: template.id) else { return nil }
            return (w, workoutService.todaySessions[template.id] != nil)
        }
        // A one-off session for a workout type with no matching template (e.g. Coach gives a
        // cali session to an athlete with no cali template) has no template entry to piggyback
        // on above — surface it directly, always as "today's" (isSession: true).
        let standaloneSessions: [(workout: Workout, isSession: Bool)] = workoutService.todaySessions
            .filter { !templateIds.contains($0.key) }
            .map { (_, workout) in (workout, true) }
        return templateEntries + standaloneSessions
    }

    private var pageActivities: [WorkoutPageActivity] {
        (widgetStore.snapshots?.home.activityEvidence ?? []).map { item in
            WorkoutPageActivity(
                start: item.dateKey,
                sport: item.sport.rawValue,
                title: item.title,
                durationMin: Int(item.durationMinutes.rounded())
            )
        }
    }

    private var page: (today: TodayHero, week: [WeekDay]?) {
        WorkoutsPageSelector.select(
            templates: workoutService.templates,
            sessions: workoutService.todaySessions,
            currentWeekJSON: workoutService.currentWeekJSON,
            activities: pageActivities,
            now: Date(),
            athleteTimeZone: nil
        )
    }

    private var groupedWorkouts: [(type: WorkoutType, entries: [(workout: Workout, isSession: Bool)])] {
        let order: [WorkoutType] = [.foundation, .strength, .calisthenics, .recovery, .realign]
        let ordered = order.compactMap { type -> (type: WorkoutType, entries: [(workout: Workout, isSession: Bool)])? in
            let entries = allWorkouts.filter { $0.workout.workoutType == type }
            return entries.isEmpty ? nil : (type, entries)
        }
        // Anything not in `order` (a future workout_type the app doesn't know how to place yet,
        // decoded via WorkoutType.other) still gets its own section instead of vanishing.
        let orderedTypes = Set(order)
        var leftoverGroups: [WorkoutType: [(workout: Workout, isSession: Bool)]] = [:]
        for entry in allWorkouts where !orderedTypes.contains(entry.workout.workoutType) {
            leftoverGroups[entry.workout.workoutType, default: []].append(entry)
        }
        // Dictionary iteration order is unspecified — sort by rawValue so leftover sections
        // stay in a stable order across renders/launches instead of shuffling.
        let leftover = leftoverGroups
            .map { (type: $0.key, entries: $0.value) }
            .sorted { $0.type.rawValue < $1.type.rawValue }
        return ordered + leftover
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    workoutsHeader
                    todayBand
                    if let week = page.week {
                        weekBand(week)
                    }

                    if !groupedWorkouts.isEmpty {
                        Text("LIBRARY")
                            .font(WarmInstrument.monoLabel(9))
                            .kerning(1.2)
                            .foregroundColor(WarmInstrument.inkFaint)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 22)
                            .padding(.top, 12)
                    }

                    VStack(alignment: .leading, spacing: 20) {
                        ForEach(groupedWorkouts, id: \.type) { group in
                            workoutGroup(type: group.type, entries: group.entries)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, groupedWorkouts.isEmpty ? 16 : 4)

                    if groupedWorkouts.isEmpty, workoutService.fetchError == nil, !workoutService.isLoading {
                        emptyState
                            .frame(maxWidth: .infinity)
                            .padding(.top, 24)
                    }
                }
            }
            .mainTabScrollBottomClearance()
            .scrollClipDisabled()
            .refreshable {
                await workoutService.fetchPage()
            }
            .task(id: workoutFetchToken) {
                guard authManager.isSessionReady else { return }
                guard authManager.repoFullName != nil else { return }
                await workoutService.fetchPage()
            }
            .overlay {
                if workoutService.isLoading && allWorkouts.isEmpty && workoutService.currentWeekJSON == nil {
                    ProgressView()
                } else if let error = workoutService.fetchError, allWorkouts.isEmpty, workoutService.currentWeekJSON == nil {
                    // A fetch failure must never look identical to "you genuinely have no
                    // plan" — that false-empty state is what sent Skanda's real workouts
                    // missing on refresh.
                    errorState(error)
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
                Task {
                    await workoutService.fetchPage()
                }
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

    @ViewBuilder
    private var todayBand: some View {
        switch page.today {
        case .runnable(let workout, _, let isDone):
            TodayWorkoutHero(workout: workout, isDone: isDone) {
                navigationPath.append(workout)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
            .staggerReveal(delay: 0.05)
        case .mention(let title, let durationMin):
            todayLine(kicker: "TODAY", title: title, durationMin: durationMin)
        case .rest:
            todayLine(kicker: "TODAY", title: "Rest", durationMin: nil)
        case .none:
            todayLine(kicker: "TODAY", title: "No plan this week", durationMin: nil)
        }
    }

    private func todayLine(kicker: String, title: String, durationMin: Int?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(kicker)
                .font(WarmInstrument.monoLabel(9))
                .kerning(1.2)
                .foregroundColor(WarmInstrument.inkFaint)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(2)
                Spacer(minLength: 0)
                if let durationMin {
                    Text("\(durationMin)M")
                        .font(WarmInstrument.figures(10))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .staggerReveal(delay: 0.05)
    }

    private func weekBand(_ days: [WeekDay]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("THIS WEEK")
                .font(WarmInstrument.monoLabel(9))
                .kerning(1.2)
                .foregroundColor(WarmInstrument.inkFaint)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.top, 8)
                .padding(.bottom, 4)

            VStack(spacing: 0) {
                ForEach(Array(days.enumerated()), id: \.element.id) { index, day in
                    SessionRow(session: sessionSnapshot(for: day), compact: true)
                        .padding(.horizontal, 22)
                    if index < days.count - 1 {
                        Divider().overlay(WarmInstrument.headerRule)
                            .padding(.leading, 22)
                    }
                }
            }
        }
    }

    private func sessionSnapshot(for day: WeekDay) -> RecentSessionSnapshot {
        let title: String
        if day.source == .empty {
            title = ""
        } else {
            title = day.title ?? ""
        }
        return RecentSessionSnapshot(
            id: day.date,
            dateLabel: weekDateLabel(day.date),
            title: title,
            detail: day.durationMin.map { "\($0)M" } ?? "",
            load: nil,
            sport: sportId(from: day.sport),
            href: nil,
            evidence: nil
        )
    }

    private func weekDateLabel(_ date: String) -> String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return date }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let parsed = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else {
            return date
        }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE d"
        return formatter.string(from: parsed).uppercased()
    }

    private func sportId(from raw: String?) -> WarmSportId {
        guard let raw else { return .other }
        if let match = WarmSportId(rawValue: raw) { return match }
        switch raw.lowercased() {
        case "ride", "bike", "cycling": return .cycling
        case "run", "running": return .run
        case "weights", "weight_training": return .weightTraining
        default: return .other
        }
    }

    private func workoutGroup(
        type: WorkoutType,
        entries: [(workout: Workout, isSession: Bool)]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Theme.workoutLabel(for: type))
                .font(WarmInstrument.monoLabel(11))
                .kerning(1.4)
                .foregroundColor(WarmInstrument.inkMuted)

            VStack(spacing: 12) {
                ForEach(entries, id: \.workout.id) { entry in
                    WarmWorkoutListCard(
                        workout: entry.workout,
                        isSession: entry.isSession,
                        isToday: entry.isSession,
                        onTap: { navigationPath.append(entry.workout) }
                    )
                }
            }
        }
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
                        .foregroundColor(Color(red: 0xC2 / 255, green: 0xBC / 255, blue: 0xAE / 255))
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
                    .stroke(Color(red: 0xDC / 255, green: 0xD5 / 255, blue: 0xC6 / 255), lineWidth: 1)
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
    var isDone: Bool = false
    let onTap: () -> Void

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 0) {
                // Accent top strip + TODAY badge
                HStack(spacing: 8) {
                    Text(isDone ? "DONE" : "TODAY")
                        .font(WarmInstrument.monoLabel(9))
                        .kerning(1.2)
                        .foregroundColor(WarmInstrument.paper)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(isDone ? WarmInstrument.ink : accent)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                    Text(Theme.workoutLabel(for: workout.workoutType))
                        .font(WarmInstrument.monoLabel(9))
                        .kerning(1.1)
                        .foregroundColor(accent)

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
