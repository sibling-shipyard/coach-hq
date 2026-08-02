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
    @State private var profileContent: String = ""

    var body: some View {
        ZStack {
            WarmInstrument.desk.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack(alignment: .center) {
                    // Invisible spacer mirrors the dismiss button width so dots stay centered
                    Color.clear.frame(width: 36, height: 36)

                    Spacer()

                    OnboardingProgressDots(step: step)

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
                        SeasonStepView(summary: summary) { content in
                            profileContent = content
                            withAnimation(PremiumMotion.state) { step = .sync }
                        }
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing),
                            removal: .move(edge: .leading)
                        ))
                    } else {
                        SyncStepView(profileContent: profileContent, onComplete: handleComplete)
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
        // Request notification permission now — after the user has finished the full
        // onboarding flow. Doing it here avoids interrupting the HK permission step and
        // prevents the "N activities synced" notification from firing mid-onboarding.
        Task { await syncManager.requestNotificationPermission() }
        syncManager.syncNotificationsEnabled = true
        onComplete()
    }
}

// MARK: - Sync step

private struct SyncStepView: View {
    @EnvironmentObject private var syncManager: HealthKitSyncManager

    let profileContent: String
    let onComplete: () -> Void

    @State private var started = false
    @State private var progress: Double = 0
    @State private var completionText = ""
    @State private var failed = false
    @State private var completionHandled = false
    @State private var needsProfileCommit = false

    private var profileExtraFiles: [(path: String, data: Data)] {
        guard !profileContent.isEmpty, let data = profileContent.data(using: .utf8) else { return [] }
        return [("user_data/profile.md", data)]
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Sync your log.")
                    .font(WarmInstrument.coachVoice(30))
                    .foregroundColor(WarmInstrument.ink)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 12)
                    .onboardingReveal(index: 0)

                Text("We'll upload your recent workouts to your GitHub log. This may take a moment.")
                    .font(.system(size: 16))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .lineSpacing(4)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 48)
                    .onboardingReveal(index: 1)

                if started {
                    VStack(alignment: .leading, spacing: 10) {
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

                        let displayText = completionText.isEmpty ? syncManager.syncProgressText : completionText
                        if !displayText.isEmpty {
                            Text(displayText)
                                .font(WarmInstrument.monoLabel(11))
                                .foregroundColor(failed ? WarmInstrument.alarmFg : WarmInstrument.inkFaint)
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
        // .task(id:) re-runs whenever lastSyncResult.id changes — more reliable than
        // onChange which can miss a result if SwiftUI batches the render cycle.
        .task(id: syncManager.lastSyncResult?.id) {
            guard started, let result = syncManager.lastSyncResult else { return }
            // If a background sync finished before our Proceed-triggered sync, we still need
            // to commit the profile. Kick off syncNewWorkouts(extraFiles:) and wait for next result.
            if needsProfileCommit {
                needsProfileCommit = false
                Task { await syncManager.syncNewWorkouts(extraFiles: profileExtraFiles) }
                return
            }
            handleResult(result)
        }
        .animation(PremiumMotion.state, value: started)
    }

    private func beginSync() {
        // Always clear stale text from a background observer sync that ran earlier.
        syncManager.syncProgressText = ""
        withAnimation(PremiumMotion.state) { started = true }

        if syncManager.isSyncing {
            // Background sync running — wait for it via .task(id:), then commit profile.
            needsProfileCommit = true
            Task { await warmProgress() }
            return
        }

        // Start sync with profile as extra file — handles new workouts + profile in one commit.
        // If a background sync already ran, workouts will be empty but profile still commits.
        Task { await syncManager.syncNewWorkouts(extraFiles: profileExtraFiles) }
        Task { await warmProgress() }
    }

    private func handleResult(_ result: HealthKitSyncManager.SyncResult) {
        guard !completionHandled else { return }
        completionHandled = true
        switch result.outcome {
        case .synced(let n):
            completionText = "\(n) workout\(n == 1 ? "" : "s") saved to GitHub"
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

    // Fills the bar from 0 → 0.82 over ~5 seconds. Stops when result arrives
    // (completionHandled = true) or view is torn down.
    private func warmProgress() async {
        let steps = 60
        let duration = 5.0
        let stepDuration = duration / Double(steps)
        for i in 1...steps {
            guard !completionHandled else { break }
            let t = Double(i) / Double(steps)
            let eased = 1.0 - pow(1.0 - t, 2.5)
            withAnimation(.linear(duration: stepDuration)) {
                progress = max(progress, 0.82 * eased)
            }
            try? await Task.sleep(nanoseconds: UInt64(stepDuration * 1_000_000_000))
        }
    }
}

// MARK: - Progress dots

private struct OnboardingProgressDots: View {
    let step: OnboardingRevealStep

    var body: some View {
        HStack(spacing: 7) {
            ForEach(OnboardingRevealStep.allCases, id: \.rawValue) { s in
                Capsule()
                    .fill(s == step ? WarmInstrument.ink : WarmInstrument.inkFaint.opacity(0.35))
                    .frame(width: s == step ? 22 : 7, height: 7)
            }
        }
        .animation(PremiumMotion.state, value: step)
    }
}

// MARK: - Shared helper

private func displaySportName(_ hkSport: String) -> String {
    switch hkSport {
    case "Run":       return "Running"
    case "Ride":      return "Cycling"
    case "WeightTraining", "Foundation": return "Strength"
    case "Yoga":      return "Yoga"
    case "Badminton": return "Badminton"
    case "Walk":      return "Walking"
    default:          return "Other"
    }
}

// MARK: - Step 2: The Reveal

private struct RevealStepView: View {
    let summary: YearSummary
    let isLoading: Bool

    @State private var displaySessions: Int = 0
    @State private var displayHours: Double = 0
    @State private var barHeights: [CGFloat] = [CGFloat](repeating: 0, count: 52)
    @State private var coachVisible = false

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

                HStack(alignment: .top, spacing: 0) {
                    BigStat(value: "\(displaySessions)", label: "sessions")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    BigStat(value: String(format: "%.0f", displayHours), label: "hours")
                        .frame(maxWidth: .infinity, alignment: .leading)
                    BigStat(value: displaySportName(summary.topSport), label: "top sport")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 40)
                .skeleton(isLoading)
                .onboardingReveal(index: 1)

                // 52-column bar strip — GeometryReader fills the available width exactly
                GeometryReader { geo in
                    let gap: CGFloat = 1
                    let barW = max((geo.size.width - gap * 51) / 52, 2)
                    HStack(alignment: .bottom, spacing: gap) {
                        ForEach(0..<52, id: \.self) { i in
                            let density = i < summary.weeklyDensity.count ? summary.weeklyDensity[i] : 0
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(density == 0
                                      ? WarmInstrument.inkFaint.opacity(0.18)
                                      : WarmInstrument.accent.opacity(0.55 + 0.45 * Double(density) / 7.0))
                                .frame(width: barW, height: max(barHeights[i], 3))
                        }
                    }
                    .frame(width: geo.size.width, height: 54, alignment: .bottom)
                }
                .frame(height: 54)
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

        try? await Task.sleep(nanoseconds: 150_000_000)
        for col in 0..<52 {
            let density = col < summary.weeklyDensity.count ? summary.weeklyDensity[col] : 0
            let target: CGFloat = density == 0 ? 3 : 54 * CGFloat(density) / 7.0
            withAnimation(.spring(duration: 0.3, bounce: 0.1)) {
                barHeights[col] = target
            }
            try? await Task.sleep(nanoseconds: UInt64(0.018 * 1_000_000_000))
        }

        try? await Task.sleep(nanoseconds: 300_000_000)
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

// MARK: - Step 3: Your Rhythms

private struct RhythmsStepView: View {
    let summary: YearSummary

    private static let dotSize: CGFloat = 5
    private static let dotGap: CGFloat = 1.5  // 52*5 + 51*1.5 = 336.5pt — fits all iPhones
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
                    Text("I can see when you push, when you rest,\nand when life gets in the way.\nI'll plan around all three.")
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
                            .fill(active ? heatmapColor(sport) : WarmInstrument.inkFaint.opacity(0.13))
                            .frame(width: Self.dotSize, height: Self.dotSize)
                    }
                }
                .scaleEffect(colsRevealed[col] ? 1 : 0, anchor: .center)
                .animation(PremiumMotion.onboardingReveal, value: colsRevealed[col])
            }
        }
        .frame(height: Self.heatmapHeight)
    }

    private func heatmapColor(_ sport: String?) -> Color {
        switch sport {
        case "Run":       return WarmInstrument.Sport.run
        case "Ride":      return WarmInstrument.Sport.cycling
        case "WeightTraining", "Foundation": return WarmInstrument.Sport.strength
        case "Yoga":      return Color(red: 0.53, green: 0.40, blue: 0.62)
        case "Badminton": return WarmInstrument.Sport.badminton
        case "Walk":      return WarmInstrument.Sport.walk
        default:          return WarmInstrument.accent
        }
    }
}

// MARK: - Step 4: Your Season

private struct SeasonStepView: View {
    let summary: YearSummary
    /// Called with the profile markdown string; sync step commits it alongside workouts.
    let onComplete: (String) -> Void

    @AppStorage("preferredName") private var preferredName = ""

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
                    .padding(.bottom, 36)
                    .onboardingReveal(index: 2)

                Button {
                    save()
                } label: {
                    Text("Next")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 15)
                        .background(WarmInstrument.accent)
                        .foregroundColor(WarmInstrument.paper)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
                }
                .buttonStyle(CardPressButtonStyle())
                .onboardingReveal(index: 3)
                .padding(.bottom, 36)
            }
            .padding(.horizontal, 28)
            .padding(.top, 24)
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
        let sportsLine = selectedSports.sorted().joined(separator: ", ")
        let name = preferredName.isEmpty ? "Athlete" : preferredName
        let content = """
# Athlete Profile
name: \(name)
sports: \(sportsLine)
sessions_last_year: \(summary.sessions)
hours_last_year: \(String(format: "%.1f", summary.hours))
top_sport: \(displaySportName(summary.topSport))
"""
        Haptics.success()
        onComplete(content)
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
                    Text(sport)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(isOn ? WarmInstrument.desk : WarmInstrument.ink)
                        .padding(.horizontal, 14)
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
