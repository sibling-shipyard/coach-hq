import SwiftUI

// MARK: - Step enum

enum OnboardingRevealStep: Int, CaseIterable {
    case reveal, rhythms, season, sync
}

// MARK: - Coordinator

struct OnboardingRevealFlow: View {
    @EnvironmentObject private var syncManager: HealthKitSyncManager
    @EnvironmentObject private var authManager: GitHubAuthManager

    let onComplete: () -> Void

    @State private var step: OnboardingRevealStep = .reveal
    @State private var summary: YearSummary = .empty
    @State private var isLoading = true

    var body: some View {
        ZStack {
            WarmInstrument.desk.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack(alignment: .center) {
                    // Invisible spacer mirrors the dismiss button width so dots stay centered
                    Color.clear.frame(width: 36, height: 36)

                    Spacer()

                    // HK is step 0, reveal=1, rhythms=2, season=3, sync=4
                    OnboardingDots(step: step.rawValue + 1, total: 5)

                    Spacer()

                    Button(action: handleComplete) {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(WarmInstrument.inkFaint)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 4)

                ZStack {
                    if step == .reveal {
                        RevealStepView(summary: summary, isLoading: isLoading)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing),
                                removal: .move(edge: .leading)
                            ))
                    } else if step == .rhythms {
                        RhythmsStepView(summary: summary)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing),
                                removal: .move(edge: .leading)
                            ))
                    } else if step == .season {
                        SeasonStepView(summary: summary) {
                            withAnimation(PremiumMotion.state) { step = .sync }
                        }
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing),
                            removal: .move(edge: .leading)
                        ))
                    } else {
                        SyncStepView(onComplete: handleComplete)
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing),
                                removal: .move(edge: .leading)
                            ))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if step != .season && step != .sync {
                    Button {
                        Haptics.tap()
                        withAnimation(PremiumMotion.state) {
                            switch step {
                            case .reveal:  step = .rhythms
                            case .rhythms: step = .season
                            case .season:  break
                            case .sync:    break
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text("Next")
                            Image(systemName: "arrow.right")
                                .font(.system(size: 14, weight: .semibold))
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(WarmInstrument.ink)
                        .foregroundColor(WarmInstrument.desk)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
                    }
                    .buttonStyle(CardPressButtonStyle())
                    .padding(.horizontal, 24)
                    .padding(.bottom, 36)
                }
            }
        }
        .task {
            summary = await syncManager.fetchYearSummary()
            isLoading = false
        }
    }

    private func handleComplete() {
        Task { await syncManager.requestNotificationPermission() }
        syncManager.syncNotificationsEnabled = true
        onComplete()
    }
}

// MARK: - Sync step

private struct SyncStepView: View {
    @EnvironmentObject private var syncManager: HealthKitSyncManager

    let onComplete: () -> Void

    @State private var started = false
    @State private var progress: Double = 0
    @State private var completionText = ""
    @State private var failed = false
    @State private var completionHandled = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Sync your log.")
                    .font(WarmInstrument.coachVoice(30))
                    .foregroundColor(WarmInstrument.ink)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 12)
                    .onboardingReveal(index: 0)

                Text("Coach reads every session to build your training picture. Keep the app open — first-time syncs can take a few minutes.")
                    .font(.system(size: 16))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .lineSpacing(4)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 48)
                    .onboardingReveal(index: 1)

                if started {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 3, style: .continuous)
                                    .fill(WarmInstrument.inkFaint.opacity(0.12))
                                    .frame(height: 4)
                                GeometryReader { geo in
                                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                                        .fill(failed ? WarmInstrument.alarmFg : WarmInstrument.accent)
                                        .frame(width: geo.size.width * progress, height: 4)
                                }
                                .frame(height: 4)
                                .animation(.easeOut(duration: 0.5), value: progress)
                            }

                            Text(String(format: "%d%%", Int(progress * 100)))
                                .font(WarmInstrument.monoLabel(11))
                                .foregroundColor(WarmInstrument.inkMuted)
                                .frame(width: 36, alignment: .trailing)
                                .contentTransition(.numericText())
                                .animation(.easeOut(duration: 0.3), value: progress)
                        }

                        let displayText = completionText.isEmpty ? syncManager.syncProgressText : completionText
                        if !displayText.isEmpty {
                            Text(displayText)
                                .font(WarmInstrument.monoLabel(12))
                                .foregroundColor(failed ? WarmInstrument.alarmFg : WarmInstrument.inkMuted)
                                .kerning(0.5)
                                .animation(.easeInOut(duration: 0.2), value: displayText)
                        }
                    }
                    .padding(.horizontal, 28)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .padding(.top, 24)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 12) {
                if !started {
                    Button {
                        Haptics.tap()
                        beginSync()
                    } label: {
                        Text("Proceed")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 15)
                            .background(WarmInstrument.ink)
                            .foregroundColor(WarmInstrument.desk)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
                    }
                    .buttonStyle(CardPressButtonStyle())
                    .transition(.opacity)
                }
                if failed {
                    Button {
                        Haptics.tap()
                        onComplete()
                    } label: {
                        Text("Skip for now")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(WarmInstrument.inkMuted)
                    }
                    .buttonStyle(.plain)
                    .transition(.opacity)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 36)
            .animation(PremiumMotion.state, value: started)
            .animation(PremiumMotion.state, value: failed)
        }
        .task(id: syncManager.lastSyncResult?.id) {
            guard started, let result = syncManager.lastSyncResult else { return }
            handleResult(result)
        }
        .onChange(of: syncManager.syncProgress) { _, p in
            guard !completionHandled else { return }
            withAnimation(.easeOut(duration: 0.4)) { progress = max(progress, p) }
        }
        .animation(PremiumMotion.state, value: started)
    }

    private func beginSync() {
        // Show immediate text so the bar never looks frozen during the GitHub API call
        syncManager.syncProgressText = "Connecting to GitHub…"
        withAnimation(PremiumMotion.state) { started = true }
        withAnimation(.easeOut(duration: 0.3)) { progress = 0.02 }

        // Fake ticker: creeps 2%→18% over ~30s so the bar shows movement during the
        // initial readSyncState network call (overridden whenever real progress arrives)
        Task {
            var fake = 0.02
            while !completionHandled && fake < 0.18 {
                try? await Task.sleep(nanoseconds: 200_000_000)
                fake = min(fake + 0.001, 0.18)
                if !completionHandled {
                    withAnimation(.easeOut(duration: 0.5)) {
                        progress = max(progress, fake)
                    }
                }
            }
        }

        if syncManager.isSyncing { return }
        Task { await syncManager.syncNewWorkouts() }
    }

    private func handleResult(_ result: HealthKitSyncManager.SyncResult) {
        guard !completionHandled else { return }
        completionHandled = true
        switch result.outcome {
        case .synced(let n):
            completionText = "\(n) workout\(n == 1 ? "" : "s") saved to Coach"
            withAnimation(.easeOut(duration: 0.4)) { progress = 1.0 }
            Task {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                onComplete()
            }
        case .nothingNew:
            completionText = "Already up to date"
            withAnimation(.easeOut(duration: 0.4)) { progress = 1.0 }
            Task {
                try? await Task.sleep(nanoseconds: 800_000_000)
                onComplete()
            }
        case .failed(let msg):
            failed = true
            completionText = msg
        }
    }
}

// MARK: - Progress dots (accessible to SetupView for the HK pre-prompt)

struct OnboardingDots: View {
    let step: Int   // 0-based current step index
    let total: Int  // total number of steps

    var body: some View {
        HStack(spacing: 7) {
            ForEach(0..<total, id: \.self) { i in
                Capsule()
                    .fill(i == step ? WarmInstrument.ink : WarmInstrument.inkFaint.opacity(0.35))
                    .frame(width: i == step ? 22 : 7, height: 7)
            }
        }
        .animation(PremiumMotion.state, value: step)
    }
}

// MARK: - Sport helpers (shared across reveal and rhythms steps)

private func sportColor(_ sport: String?) -> Color {
    guard let sport else { return WarmInstrument.accent }
    return sportDisplayInfo(sport).color
}

private func sportDisplayInfo(_ sport: String) -> (name: String, symbol: String, color: Color) {
    switch sport {
    case "Run":
        return ("Running",    "figure.run",                   WarmInstrument.Sport.run)
    case "Ride":
        return ("Cycling",    "figure.outdoor.cycle",         WarmInstrument.Sport.cycling)
    case "WeightTraining", "Foundation":
        return ("Strength",   "dumbbell.fill",                WarmInstrument.Sport.strength)
    case "Walk":
        return ("Walking",    "figure.walk",                  WarmInstrument.Sport.walk)
    case "Yoga":
        return ("Yoga",       "figure.flexibility",           Color(red: 0.53, green: 0.40, blue: 0.62))
    case "Swimming":
        return ("Swimming",   "figure.pool.swim",             WarmInstrument.Sport.swim)
    case "Hiking":
        return ("Hiking",     "figure.hiking",                WarmInstrument.Sport.hike)
    case "Rowing":
        return ("Rowing",     "figure.rowing",                WarmInstrument.Sport.other)
    case "Tennis":
        return ("Tennis",     "figure.tennis",                WarmInstrument.Sport.tennis)
    case "Football":
        return ("Football",   "soccerball",                   WarmInstrument.Sport.football)
    case "Basketball":
        return ("Basketball", "figure.basketball",            WarmInstrument.Sport.other)
    case "Badminton":
        return ("Badminton",  "figure.badminton",             WarmInstrument.Sport.badminton)
    default:
        return ("Training",   "figure.mixed.cardio",          WarmInstrument.Sport.other)
    }
}

private func displaySportName(_ hkSport: String) -> String {
    sportDisplayInfo(hkSport).name
}

private func dayOfWeekName(_ index: Int) -> String {
    let days = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
    guard index >= 0, index < days.count else { return "" }
    return days[index]
}

// MARK: - Step 1: The Reveal

private struct RevealStepView: View {
    let summary: YearSummary
    let isLoading: Bool

    @State private var displaySessions: Int = 0
    @State private var displayHours: Double = 0
    @State private var monthBarHeights: [CGFloat] = [CGFloat](repeating: 0, count: 12)
    @State private var sportTilesVisible = false
    @State private var coachVisible = false

    private var top3Sports: [(sport: String, hours: Double)] {
        summary.sportHours
            .sorted { $0.value > $1.value }
            .prefix(3)
            .map { (sport: $0.key, hours: $0.value) }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Look what you\nbuilt last year.")
                    .font(WarmInstrument.coachVoice(30))
                    .foregroundColor(WarmInstrument.ink)
                    .lineSpacing(4)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 36)
                    .onboardingReveal(index: 0)

                // Stats: sessions · hours · streak
                HStack(alignment: .top, spacing: 0) {
                    BigStat(value: "\(displaySessions)", label: "sessions")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Rectangle()
                        .fill(WarmInstrument.inkFaint.opacity(0.22))
                        .frame(width: 1, height: 42)
                        .padding(.horizontal, 12)
                        .padding(.top, 2)
                    BigStat(value: String(format: "%.0f", displayHours), label: "hours")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Rectangle()
                        .fill(WarmInstrument.inkFaint.opacity(0.22))
                        .frame(width: 1, height: 42)
                        .padding(.horizontal, 12)
                        .padding(.top, 2)
                    BigStat(
                        value: summary.longestStreak > 0 ? "\(summary.longestStreak)" : "—",
                        label: "day streak"
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 28)
                .skeleton(isLoading)
                .onboardingReveal(index: 1)

                // Top 3 sports by hours
                if sportTilesVisible && !top3Sports.isEmpty {
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(top3Sports, id: \.sport) { item in
                            SportHoursTile(sport: item.sport, hours: item.hours)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(.horizontal, 28)
                    .padding(.bottom, 32)
                    .skeleton(isLoading)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                // 12-bar monthly hours chart
                GeometryReader { geo in
                    let gap: CGFloat = 3
                    let barW = max((geo.size.width - gap * 11) / 12, 4)
                    HStack(alignment: .bottom, spacing: gap) {
                        ForEach(0..<12, id: \.self) { i in
                            let stat = i < summary.monthlyHours.count
                                ? summary.monthlyHours[i]
                                : MonthStat(hours: 0, topSport: nil)
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(stat.hours == 0
                                      ? WarmInstrument.inkFaint.opacity(0.18)
                                      : sportColor(stat.topSport).opacity(0.78))
                                .frame(width: barW, height: max(monthBarHeights[i], 3))
                        }
                    }
                    .frame(width: geo.size.width, height: 90, alignment: .bottom)
                }
                .frame(height: 90)
                .padding(.horizontal, 28)
                .padding(.bottom, 28)
                .skeleton(isLoading)
                .onboardingReveal(index: 2)

                if coachVisible {
                    Text(summary.sessions == 0
                         ? "Nothing logged yet —\nthat changes now."
                         : "This is what you've built.\nI'll work around it.")
                        .font(WarmInstrument.coachVoice(17))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineSpacing(3)
                        .padding(.horizontal, 28)
                        .staggerReveal(delay: 0.1, offset: 8)
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
        .task(id: isLoading) {
            guard !isLoading else { return }
            await runRevealAnimations()
        }
    }

    private func runRevealAnimations() async {
        let steps = 48
        let duration: Double = 1.2
        let interval = duration / Double(steps)
        for i in 1...steps {
            let t = Double(i) / Double(steps)
            let eased = 1 - pow(1 - t, 3)
            displaySessions = Int(Double(summary.sessions) * eased)
            displayHours = summary.hours * eased
            try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
        }
        displaySessions = summary.sessions
        displayHours = summary.hours

        // Sport tiles
        try? await Task.sleep(nanoseconds: 200_000_000)
        withAnimation(PremiumMotion.reveal) { sportTilesVisible = true }

        // Monthly bars grow left-to-right
        try? await Task.sleep(nanoseconds: 300_000_000)
        let maxHours = summary.monthlyHours.map(\.hours).max() ?? 1
        for col in 0..<12 {
            let h = col < summary.monthlyHours.count ? summary.monthlyHours[col].hours : 0
            let target: CGFloat = h == 0 ? 3 : 90 * CGFloat(h) / CGFloat(maxHours)
            withAnimation(.spring(duration: 0.45, bounce: 0.12)) {
                monthBarHeights[col] = target
            }
            try? await Task.sleep(nanoseconds: UInt64(0.05 * 1_000_000_000))
        }

        try? await Task.sleep(nanoseconds: 350_000_000)
        withAnimation(PremiumMotion.reveal) { coachVisible = true }
    }
}

private struct BigStat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.system(size: 30, weight: .bold).monospacedDigit())
                .foregroundColor(WarmInstrument.ink)
                .minimumScaleFactor(0.55)
                .lineLimit(1)
            Text(label.uppercased())
                .font(WarmInstrument.monoLabel(9))
                .foregroundColor(WarmInstrument.inkFaint)
                .kerning(1.2)
        }
    }
}

private struct SportHoursTile: View {
    let sport: String
    let hours: Double

    private var info: (name: String, symbol: String, color: Color) {
        sportDisplayInfo(sport)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: info.symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(info.color)
            Text(String(format: "%.0fh", hours))
                .font(.system(size: 24, weight: .bold).monospacedDigit())
                .foregroundColor(WarmInstrument.ink)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text(info.name.uppercased())
                .font(WarmInstrument.monoLabel(8))
                .foregroundColor(WarmInstrument.inkFaint)
                .kerning(1.0)
        }
    }
}

// MARK: - Step 2: Your Rhythms

private struct RhythmsStepView: View {
    let summary: YearSummary

    private static let dotSize: CGFloat = 5
    private static let dotGap: CGFloat = 1.5
    private static let heatmapHeight: CGFloat = 7 * dotSize + 6 * dotGap

    @State private var colsRevealed: [Bool] = [Bool](repeating: false, count: 52)
    @State private var coachVisible = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Your rhythms.")
                    .font(WarmInstrument.coachVoice(30))
                    .foregroundColor(WarmInstrument.ink)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 32)
                    .onboardingReveal(index: 0)

                heatmapGrid
                    .padding(.horizontal, 16)
                    .padding(.bottom, 28)

                if coachVisible {
                    VStack(alignment: .leading, spacing: 16) {
                        let insight = insightText
                        if !insight.isEmpty {
                            Text(insight)
                                .font(WarmInstrument.monoLabel(11))
                                .foregroundColor(WarmInstrument.inkMuted)
                                .lineSpacing(3)
                                .padding(.horizontal, 28)
                                .staggerReveal(delay: 0.05, offset: 6)
                        }

                        Text("I can see when you push, when you rest,\nand when life gets in the way.\nI'll plan around all three.")
                            .font(WarmInstrument.coachVoice(17))
                            .foregroundColor(WarmInstrument.inkMuted)
                            .lineSpacing(3)
                            .padding(.horizontal, 28)
                            .staggerReveal(delay: 0.2, offset: 8)
                    }
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
        .task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            for col in 0..<52 {
                withAnimation(PremiumMotion.onboardingReveal) {
                    colsRevealed[col] = true
                }
                try? await Task.sleep(nanoseconds: UInt64(0.012 * 1_000_000_000))
            }
            try? await Task.sleep(nanoseconds: 400_000_000)
            withAnimation(PremiumMotion.reveal) { coachVisible = true }
        }
    }

    private var insightText: String {
        var parts: [String] = []
        if summary.longestStreak > 1 {
            parts.append("\(summary.longestStreak)-day longest streak")
        }
        if summary.mostActiveDayOfWeek >= 0 {
            parts.append("most active on \(dayOfWeekName(summary.mostActiveDayOfWeek))")
        }
        return parts.joined(separator: "  ·  ")
    }

    private var heatmapGrid: some View {
        HStack(alignment: .top, spacing: Self.dotGap) {
            ForEach(0..<52, id: \.self) { col in
                VStack(spacing: Self.dotGap) {
                    ForEach(0..<7, id: \.self) { row in
                        let active = col < summary.dailyActivity.count
                            && row < summary.dailyActivity[col].count
                            && summary.dailyActivity[col][row]
                        let sport: String? = col < summary.dailySport.count
                            && row < summary.dailySport[col].count
                            ? summary.dailySport[col][row] : nil
                        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                            .fill(active ? sportColor(sport) : WarmInstrument.inkFaint.opacity(0.13))
                            .frame(width: Self.dotSize, height: Self.dotSize)
                    }
                }
                .scaleEffect(colsRevealed[col] ? 1 : 0, anchor: .center)
                .animation(PremiumMotion.onboardingReveal, value: colsRevealed[col])
            }
        }
        .frame(height: Self.heatmapHeight)
    }
}

// MARK: - Step 3: Your Season

private struct SeasonStepView: View {
    let summary: YearSummary
    let onComplete: () -> Void

    private static let allSports = [
        "Running", "Cycling", "Swimming", "Strength",
        "Yoga", "Hiking", "Rowing", "Tennis",
        "Football", "Basketball", "Badminton", "Other"
    ]

    @State private var selectedSports: Set<String> = []

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Your season.")
                    .font(WarmInstrument.coachVoice(30))
                    .foregroundColor(WarmInstrument.ink)
                    .padding(.bottom, 8)
                    .onboardingReveal(index: 0)

                Text("What are you training for?")
                    .font(.system(size: 15))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .padding(.bottom, 28)
                    .onboardingReveal(index: 1)

                SportChipGrid(sports: Self.allSports, selected: $selectedSports)
                    .padding(.bottom, 16)
                    .onboardingReveal(index: 2)
            }
            .padding(.horizontal, 28)
            .padding(.top, 24)
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                save()
            } label: {
                HStack(spacing: 6) {
                    Text("Next")
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .semibold))
                }
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(WarmInstrument.ink)
                .foregroundColor(WarmInstrument.desk)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            }
            .buttonStyle(CardPressButtonStyle())
            .padding(.horizontal, 24)
            .padding(.bottom, 36)
        }
        .onAppear { preSelectSports() }
    }

    private func preSelectSports() {
        var displayCounts: [String: Int] = [:]
        for (hkSport, count) in summary.sportCounts {
            let display = Self.mapToDisplay(hkSport)
            displayCounts[display, default: 0] += count
        }
        let top = displayCounts
            .sorted { $0.value > $1.value }
            .prefix(3)
            .map { $0.key }
            .filter { Self.allSports.contains($0) }
        selectedSports = Set(top)
    }

    private func save() {
        OnboardingHints.save(sports: selectedSports.sorted(), goal: "")
        Haptics.success()
        onComplete()
    }

    static func mapToDisplay(_ hkSport: String) -> String {
        switch hkSport {
        case "Run":       return "Running"
        case "Ride":      return "Cycling"
        case "WeightTraining", "Foundation": return "Strength"
        case "Yoga":      return "Yoga"
        case "Walk":      return "Walking"
        case "Swimming":  return "Swimming"
        case "Hiking":    return "Hiking"
        case "Rowing":    return "Rowing"
        case "Tennis":    return "Tennis"
        case "Football":  return "Football"
        case "Basketball": return "Basketball"
        case "Badminton": return "Badminton"
        default:          return "Other"
        }
    }
}

private struct SportChipGrid: View {
    let sports: [String]
    @Binding var selected: Set<String>

    private func glyph(for sport: String) -> String {
        switch sport {
        case "Running":    return "figure.run"
        case "Cycling":    return "figure.outdoor.cycle"
        case "Swimming":   return "figure.pool.swim"
        case "Strength":   return "dumbbell.fill"
        case "Yoga":       return "figure.flexibility"
        case "Hiking":     return "figure.hiking"
        case "Rowing":     return "figure.rowing"
        case "Tennis":     return "figure.tennis"
        case "Football":   return "soccerball"
        case "Basketball": return "figure.basketball"
        case "Badminton":  return "figure.badminton"
        case "Walking":    return "figure.walk"
        default:           return "figure.mixed.cardio"
        }
    }

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(sports, id: \.self) { sport in
                Button {
                    Haptics.tap()
                    withAnimation(PremiumMotion.state) {
                        if selected.contains(sport) {
                            selected.remove(sport)
                        } else {
                            selected.insert(sport)
                        }
                    }
                } label: {
                    let isOn = selected.contains(sport)
                    HStack(spacing: 5) {
                        Image(systemName: glyph(for: sport))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(isOn ? WarmInstrument.desk.opacity(0.9) : WarmInstrument.inkMuted)
                        Text(sport)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(isOn ? WarmInstrument.desk : WarmInstrument.ink)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(isOn ? WarmInstrument.ink : WarmInstrument.paper)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(isOn ? Color.clear : WarmInstrument.border, lineWidth: 1)
                    )
                    .animation(PremiumMotion.state, value: isOn)
                }
                .buttonStyle(CardPressButtonStyle())
            }
        }
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowH: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxW, x > 0 {
                y += rowH + spacing
                x = 0
                rowH = 0
            }
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
        return CGSize(width: maxW, height: y + rowH)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowH: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                y += rowH + spacing
                x = bounds.minX
                rowH = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
    }
}
