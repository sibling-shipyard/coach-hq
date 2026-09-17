import SwiftUI

/// Train tab — Day Card, Week Strip L, library. Selector is pure; this view fetches
/// and hosts the gestures.
struct WorkoutListView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var workoutService: WorkoutService
    @EnvironmentObject var widgetStore: WidgetSnapshotStore
    @EnvironmentObject var allActivitiesStore: AllActivitiesStore

    @State private var navigationPath = NavigationPath()
    @State private var selection = WorkoutsPageSelector.Selection(today: .none, week: nil)
    @State private var selectedDate: String = ""
    @State private var focusIndex = 0
    @State private var weekListOpen = false
    @State private var cardTravel: Int = 1
    @State private var today: String = ""

    private var workoutFetchToken: String {
        [
            authManager.isSessionReady ? "ready" : "boot",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
    }

    private static let libraryOrder: [WorkoutType] = [.foundation, .strength, .calisthenics, .recovery, .realign]

    private var library: [Workout] {
        let templateIds = Set(workoutService.templates.map(\.id))
        let standalone = workoutService.todaySessions.values.filter { !templateIds.contains($0.id) }
        let all = workoutService.templates + standalone
        return all.sorted { a, b in
            let ai = Self.libraryOrder.firstIndex(of: a.workoutType) ?? .max
            let bi = Self.libraryOrder.firstIndex(of: b.workoutType) ?? .max
            if ai != bi { return ai < bi }
            return a.title < b.title
        }
    }

    private var isEmpty: Bool {
        selection.week == nil && library.isEmpty
    }

    private var selectedDay: WorkoutsPageSelector.TrainDay? {
        selection.week?.days.first { $0.date == selectedDate }
            ?? selection.week?.days.first { $0.isToday }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header

                    ZStack {
                        if let day = selectedDay {
                            TrainDayCard(
                                day: day,
                                focusIndex: focusIndex,
                                onFocus: { focusIndex = $0 },
                                onOpen: open,
                                onStart: start,
                                onSwipe: swipe
                            )
                            .id(day.date)
                            .transition(.asymmetric(
                                insertion: .move(edge: cardTravel > 0 ? .trailing : .leading).combined(with: .opacity),
                                removal: .opacity
                            ))
                        }
                    }
                    .animation(.spring(duration: 0.18, bounce: 0), value: selectedDate)

                    if let week = selection.week {
                        TrainWeekStrip(
                            week: week,
                            selectedDate: selectedDay?.date ?? today,
                            listOpen: $weekListOpen,
                            onSelectDate: selectDate
                        )
                    }

                    if !library.isEmpty {
                        libraryCard
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            }
            .contentMargins(.bottom, weekListOpen ? 220 : 160, for: .scrollContent)
            .scrollClipDisabled()
            .refreshable { await refreshAll() }
            .task(id: workoutFetchToken) {
                guard authManager.isSessionReady, authManager.repoFullName != nil else { return }
                await refreshAll()
            }
            .onChange(of: allActivitiesStore.loadedEntries.count) { _, _ in
                Task { await recomputeSelection(fetchSessions: false) }
            }
            .overlay {
                ZStack {
                    if let error = workoutService.fetchError,
                       workoutService.templates.isEmpty,
                       !(workoutService.isLoading && isEmpty) {
                        errorState(error)
                    } else if isEmpty, !(workoutService.isLoading && workoutService.templates.isEmpty) {
                        emptyState
                    }
                    WarmPageWaitCover(
                        isWaiting: workoutService.isLoading && workoutService.templates.isEmpty && isEmpty
                    )
                }
            }
            .onChange(of: workoutService.fetchError) { _, newError in
                authManager.noteAPIError(newError)
            }
            .background(WarmInstrument.desk)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Workout.self) { workout in
                WorkoutOverviewView(workout: workout)
            }
            .navigationDestination(for: TrainWorkoutLaunch.self) { launch in
                WorkoutOverviewView(workout: launch.workout, autoStart: launch.start)
            }
            .navigationDestination(for: SyncCacheEntry.self) { entry in
                ActivityDetailView(entry: entry)
            }
        }
    }

    // MARK: - Fetch

    private func refreshAll() async {
        async let templates: Void = workoutService.fetchTemplates()
        async let week: Void = workoutService.fetchCurrentWeek()
        async let timezone: Void = workoutService.fetchAthleteTimezone()
        async let hist: Void = loadHistIfPossible()
        _ = await (templates, week, timezone)
        // Plan + 7-day cache first. Hist is 50 GitHub reads; waiting on it left only the library.
        await recomputeSelection(fetchSessions: true)
        await hist
        await recomputeSelection(fetchSessions: false)
    }

    private func loadHistIfPossible() async {
        guard let repo = authManager.repoFullName else { return }
        await allActivitiesStore.loadInitialIfNeeded(
            repo: repo,
            client: GitHubActivityHistClient(authManager: authManager)
        )
    }

    private func recomputeSelection(fetchSessions: Bool) async {
        let plan = workoutService.currentWeek
        let availability = workoutService.currentWeekAvailability
        let live = (availability?.available ?? false) && plan != nil

        let todayZone: String
        if live, let plan {
            todayZone = plan.timezone
        } else {
            todayZone = workoutService.athleteTimezone ?? "UTC"
        }
        let resolvedToday = dateString(for: Date(), inTimeZoneIdentifier: todayZone)
        today = resolvedToday

        if fetchSessions {
            let sessionDate = selectedDate.isEmpty ? resolvedToday : selectedDate
            await workoutService.fetchTodaySessions(forDate: sessionDate)
        }

        let next = WorkoutsPageSelector.select(WorkoutsPageSelector.Input(
            currentWeek: plan,
            availability: availability,
            templates: workoutService.templates,
            sessionsForDate: workoutService.todaySessions,
            loggedActivities: mergedHist(),
            loadHints: loadHints,
            today: resolvedToday
        ))
        selection = next

        if selectedDate.isEmpty || next.week?.days.contains(where: { $0.date == selectedDate }) != true {
            selectedDate = resolvedToday
            if let day = next.week?.days.first(where: { $0.date == resolvedToday }) {
                focusIndex = WorkoutsPageSelector.defaultFocusIndex(in: day)
            }
        }
    }

    private func mergedHist() -> [SyncCacheEntry] {
        var byName: [String: SyncCacheEntry] = [:]
        for entry in SyncCache.load() + allActivitiesStore.loadedEntries {
            byName[entry.fileName] = entry
        }
        return Array(byName.values)
    }

    private var loadHints: WorkoutsPageSelector.LoadHints {
        var hints = WorkoutsPageSelector.LoadHints()
        guard let home = widgetStore.snapshots?.home else { return hints }
        hints.bandLow = home.engine.bandLow
        hints.bandHigh = home.engine.bandHigh
        for day in home.plan.days {
            if let load = day.loadDelta {
                hints.loadByDate[day.key] = Int(load.rounded())
            }
        }
        return hints
    }

    // MARK: - Selection

    private func selectDate(_ date: String) {
        guard date != selectedDate else { return }
        cardTravel = date > selectedDate ? 1 : -1
        selectedDate = date
        if let day = selection.week?.days.first(where: { $0.date == date }) {
            focusIndex = WorkoutsPageSelector.defaultFocusIndex(in: day)
        } else {
            focusIndex = 0
        }
    }

    private func swipe(_ delta: Int) {
        guard let week = selection.week,
              let current = week.days.firstIndex(where: { $0.date == (selectedDay?.date ?? selectedDate) })
        else { return }
        let next = current + delta
        guard week.days.indices.contains(next) else { return }
        selectDate(week.days[next].date)
    }

    private func open(_ session: WorkoutsPageSelector.TrainSession) {
        if session.status == .logged, let entry = session.activity {
            navigationPath.append(entry)
        } else if let workout = session.workout {
            navigationPath.append(workout)
        }
    }

    private func start(_ session: WorkoutsPageSelector.TrainSession) {
        guard let workout = session.workout else { return }
        navigationPath.append(TrainWorkoutLaunch(workout: workout, start: true))
    }

    // MARK: - Chrome

    private var header: some View {
        WarmPageHeader(
            title: "TRAIN",
            trailing: WarmPageDate.label(isoDay: selectedDay?.date ?? selectedDate)
        )
    }

    private var libraryCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("LIBRARY · \(library.count) PROTOCOLS")
                .font(WarmInstrument.monoLabel(9))
                .tracking(1.2)
                .foregroundColor(WarmInstrument.inkFaintText)
                .padding(.bottom, 10)

            VStack(spacing: 0) {
                ForEach(library) { workout in
                    Button {
                        navigationPath.append(workout)
                    } label: {
                        libraryRow(workout)
                    }
                    .buttonStyle(CardPressButtonStyle())

                    if workout.id != library.last?.id {
                        Rectangle()
                            .fill(WarmInstrument.headerRule)
                            .frame(height: 1)
                            .padding(.leading, 15)
                    }
                }
            }
            .padding(.vertical, 4)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: TrainLayout.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TrainLayout.cardRadius, style: .continuous)
                    .strokeBorder(WarmInstrument.border, lineWidth: 1)
            )
            .shadow(color: WarmInstrument.cardShadow, radius: 14, y: 7)
        }
    }

    private func libraryRow(_ workout: Workout) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 1)
                .fill(Theme.workoutColor(for: workout.workoutType))
                .frame(width: 3, height: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(workout.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)
                Text(libraryMeta(workout))
                    .font(WarmInstrument.monoLabel(8.5, weight: .regular))
                    .tracking(1.0)
                    .foregroundColor(WarmInstrument.inkFaintText)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Text("→")
                .font(.system(size: 15))
                .foregroundColor(WarmInstrument.inkFaint)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private func libraryMeta(_ workout: Workout) -> String {
        [
            workout.subtitle.uppercased(),
            "\(workout.estimatedDurationMins)M",
            "\(workout.exerciseCount) EX",
        ]
        .filter { !$0.isEmpty }
        .joined(separator: " · ")
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text("Nothing on the desk")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
            Text("Ask Coach when the week is ready.")
                .font(WarmInstrument.coachVoice(14.5))
                .foregroundColor(WarmInstrument.inkMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 40)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
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
}

private struct TrainWorkoutLaunch: Hashable {
    let workout: Workout
    let start: Bool
}
