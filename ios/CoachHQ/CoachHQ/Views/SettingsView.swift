import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var router: AppRouter
    @ObservedObject var testMode = TestModeManager.shared
    @AppStorage(Theme.darkModeKey) private var darkModeEnabled = false
    @AppStorage(UserFacingError.devModeKey) private var devModeEnabled = false
    @AppStorage("preferredName") private var preferredName = ""
    @AppStorage(HRZoneConfig.zone1UpperKey) private var zone1Upper = HRZoneConfig.defaultZone1Upper
    @AppStorage(HRZoneConfig.zone2UpperKey) private var zone2Upper = HRZoneConfig.defaultZone2Upper
    @AppStorage(HRZoneConfig.zone3UpperKey) private var zone3Upper = HRZoneConfig.defaultZone3Upper
    @AppStorage(HRZoneConfig.zone4UpperKey) private var zone4Upper = HRZoneConfig.defaultZone4Upper

    @State private var isResetting = false
    @State private var resetResult: String?
    @State private var hrZonesExpanded = false
    @State private var cacheCleared = false
    @State private var toast: Toast?
    @State private var devTapCount = 0
    @State private var isEditingName = false
    @State private var nameDraft = ""
    @State private var showDiagHelp = false
    @State private var showSignOutConfirmation = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    SettingsProfileHeader(
                        user: authManager.user,
                        preferredName: preferredName,
                        repo: authManager.selectedRepo
                    )
                    .padding(.bottom, 4)

                    trainingSection
                    syncSection
                    appearanceSection
                    accountSection
                    aboutSection

                    if devModeEnabled || testMode.isEnabled {
                        developerSection
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .animation(PremiumMotion.state, value: devModeEnabled || testMode.isEnabled)
            }
            .mainTabScrollBottomClearance()
            .scrollClipDisabled()
            .background(WarmInstrument.desk.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .toast($toast)
            .onChange(of: syncManager.lastSyncResult) { _, result in
                guard let result else { return }
                switch result.outcome {
                case .synced(let n):
                    Haptics.success()
                    toast = Toast(kind: .success, message: "Synced \(n) new activit\(n == 1 ? "y" : "ies")")
                case .nothingNew:
                    Haptics.tap()
                    toast = Toast(kind: .info, message: "Up to date — nothing new")
                case .failed(let message):
                    Haptics.error()
                    toast = Toast(kind: .error, message: message)
                }
            }
            .overlay {
                if showSignOutConfirmation {
                    WarmDialog(
                        title: "Sign Out?",
                        message: "You'll need to sign in again to access your training data.",
                        primaryTitle: "Sign Out",
                        primaryAction: { authManager.signOut() },
                        secondaryTitle: "Cancel",
                        secondaryAction: { showSignOutConfirmation = false },
                        primaryColor: WorkoutTimerWarm.rust,
                        onBackdropTap: { showSignOutConfirmation = false }
                    )
                    .transition(.opacity)
                }
            }
            .animation(.spring(duration: 0.25, bounce: 0), value: showSignOutConfirmation)
        }
    }

    // MARK: - Training (HR Zones)

    private var trainingSection: some View {
        WarmSettingsSection(title: "Training") {
            Button {
                withAnimation(.spring(duration: 0.3, bounce: 0.1)) {
                    hrZonesExpanded.toggle()
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 14))
                        .foregroundColor(Theme.heartRateColor)

                    Text("Heart Rate Zones")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Theme.ink)

                    Spacer(minLength: 8)

                    Text("\(zone1Upper)/\(zone2Upper)/\(zone3Upper)/\(zone4Upper)")
                        .font(WarmInstrument.figures(11))
                        .foregroundColor(WarmInstrument.inkFaint)

                    Image(systemName: hrZonesExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
            }
            .buttonStyle(.plain)

            if hrZonesExpanded {
                WarmSettingsDivider()

                VStack(spacing: 12) {
                    WarmZoneStepper(label: "Zone 1 upper", value: $zone1Upper, range: 100...160)
                    WarmZoneStepper(label: "Zone 2 upper", value: $zone2Upper, range: 120...170)
                    WarmZoneStepper(label: "Zone 3 upper", value: $zone3Upper, range: 140...180)
                    WarmZoneStepper(label: "Zone 4 upper", value: $zone4Upper, range: 150...200)

                    Text("Zone 5: above \(zone4Upper) bpm")
                        .font(WarmInstrument.monoLabel(10))
                        .foregroundColor(WarmInstrument.inkFaint)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    // MARK: - Sync

    private var syncSection: some View {
        WarmSettingsSection(title: "Sync") {
            HStack(spacing: 12) {
                Image(systemName: syncManager.isSyncing ? "arrow.triangle.2.circlepath" : "checkmark.circle")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundColor(syncManager.isSyncing ? WorkoutTimerWarm.amber : WarmInstrument.sportColor(.foundation))
                    .rotationEffect(syncManager.isSyncing ? .degrees(360) : .zero)
                    .animation(
                        syncManager.isSyncing
                            ? .linear(duration: 1).repeatForever(autoreverses: false)
                            : .default,
                        value: syncManager.isSyncing
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(syncManager.isSyncing ? "Syncing..." : "Up to date")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Theme.ink)

                    if let lastSync = syncManager.lastSyncDate {
                        Text("Last synced \(lastSync.formatted(.relative(presentation: .named)))")
                            .font(WarmInstrument.figures(11))
                            .foregroundColor(WarmInstrument.inkFaint)
                    } else {
                        Text("Not synced yet")
                            .font(WarmInstrument.figures(11))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                }

                Spacer(minLength: 0)
            }

            if let error = syncManager.syncError {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.accent)
            }

            Button {
                Haptics.tap()
                Task { await syncManager.syncNewWorkouts() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                    Text(syncManager.isSyncing ? "Syncing..." : "Sync Now")
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(WarmInstrument.paper)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(WorkoutTimerWarm.rust)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .shadow(color: WorkoutTimerWarm.rust.opacity(0.28), radius: 8, y: 4)
            }
            .buttonStyle(TimerWarmPressStyle())
            .disabled(syncManager.isSyncing)
            .opacity(syncManager.isSyncing ? 0.6 : 1)

            if !syncManager.hkAuthorizationGranted {
                Button {
                    Task { await syncManager.connectHealthKit() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "heart.fill")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Connect Health")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundColor(WarmInstrument.paper)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(Theme.heartRateColor)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(TimerWarmPressStyle())
            }

            Text("Pull down on Home to refresh your dashboard. Sync Now pushes new workouts from HealthKit to GitHub.")
                .font(.system(size: 12))
                .foregroundColor(WarmInstrument.inkFaint)
                .fixedSize(horizontal: false, vertical: true)

            if let repo = authManager.selectedRepo {
                WarmSettingsDivider()
                HStack(spacing: 8) {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .frame(width: 18)
                    Text(repo)
                        .font(WarmInstrument.figures(11))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                }
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        WarmSettingsSection(title: "Appearance") {
            WarmSettingsToggleRow(
                title: "Dark Mode",
                icon: darkModeEnabled ? "moon.fill" : "sun.max.fill",
                iconColor: darkModeEnabled ? WarmInstrument.alarmFg : WorkoutTimerWarm.amber,
                isOn: $darkModeEnabled
            )
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        WarmSettingsSection(title: "Account") {
            HStack(spacing: 12) {
                Image(systemName: "person.text.rectangle")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .frame(width: 22)

                Text("Name")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.ink)

                Spacer(minLength: 8)

                if isEditingName {
                    TextField("Sky", text: $nameDraft)
                        .font(.system(size: 14))
                        .foregroundColor(WarmInstrument.ink)
                        .multilineTextAlignment(.trailing)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.words)
                        .submitLabel(.done)
                        .onSubmit { commitNameEdit() }
                        .frame(maxWidth: 140)
                } else {
                    Button {
                        nameDraft = preferredName
                        isEditingName = true
                    } label: {
                        HStack(spacing: 4) {
                            Text(preferredName.isEmpty ? (authManager.user?.login ?? "—") : preferredName)
                                .font(.system(size: 14))
                                .foregroundColor(WarmInstrument.inkFaint)
                            Image(systemName: "pencil")
                                .font(.system(size: 11))
                                .foregroundColor(WarmInstrument.inkFaint)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            WarmSettingsDivider()

            Button {
                showSignOutConfirmation = true
            } label: {
                Text("Sign Out")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundColor(WarmInstrument.accent)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(WarmInstrument.paper)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(WarmInstrument.headerRule, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(TimerWarmPressStyle())
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        WarmSettingsSection(title: "About") {
            // 5 taps on the version number unlocks the developer section.
            Button {
                devTapCount += 1
                if devTapCount >= 5 {
                    devTapCount = 0
                    if !devModeEnabled {
                        devModeEnabled = true
                        Haptics.success()
                        toast = Toast(kind: .info, message: "Developer mode unlocked")
                    }
                }
            } label: {
                WarmSettingsInfoRow(label: "Version", value: appVersion)
            }
            .buttonStyle(.plain)

            WarmSettingsDivider()
            WarmSettingsInfoRow(label: "Developers", value: "Sibling Shipyard")
        }
    }

    // MARK: - Developer (hidden; unlocked by 5-tapping the version number)

    private var developerSection: some View {
        WarmSettingsSection(title: "Developer") {
            WarmSettingsToggleRow(
                title: "Dev Mode",
                icon: "ladybug",
                iconColor: WarmInstrument.inkMuted,
                isOn: $devModeEnabled
            )

            Text("Shows technical error details on login and setup screens.")
                .font(.system(size: 11))
                .foregroundColor(WarmInstrument.inkFaint)

            WarmSettingsToggleRow(
                title: "Test Mode",
                icon: "arrow.triangle.branch",
                iconColor: WorkoutTimerWarm.amber,
                isOn: $testMode.isEnabled
            )

            if testMode.isEnabled {
                HStack(spacing: 8) {
                    MonoLabel("SYNCING TO", size: 9, color: WarmInstrument.inkFaint)
                    Text("test/sync")
                        .font(WarmInstrument.figures(11, weight: .bold))
                        .foregroundColor(WorkoutTimerWarm.amber)
                }
                .padding(.top, 2)

                Button {
                    Task { await resetTestBranch() }
                } label: {
                    HStack(spacing: 8) {
                        if isResetting {
                            ProgressView()
                                .controlSize(.small)
                                .tint(WarmInstrument.paper)
                        }
                        Text(isResetting ? "Resetting..." : "Reset Test Branch")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundColor(WarmInstrument.paper)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(WorkoutTimerWarm.rust)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .shadow(color: WorkoutTimerWarm.rust.opacity(0.28), radius: 8, y: 4)
                }
                .buttonStyle(TimerWarmPressStyle())
                .disabled(isResetting)

                if let resetResult {
                    Text(resetResult)
                        .font(WarmInstrument.figures(11))
                        .foregroundColor(resetResult.contains("✓") ? WarmInstrument.sportColor(.foundation) : WarmInstrument.accent)
                }

                Text("Deletes test/sync and recreates it from main HEAD. All test data is wiped.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkFaint)
            } else {
                Text("Enable Test Mode to sync to a test branch instead of main.")
                    .font(WarmInstrument.coachVoice(13))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            WarmSettingsDivider()

            Button {
                SyncCache.clear()
                cacheCleared = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "trash")
                        .font(.system(size: 13, weight: .medium))
                    Text("Clear Activity Cache")
                        .font(.system(size: 13.5, weight: .semibold))
                }
                .foregroundColor(Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(WarmInstrument.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(WarmInstrument.headerRule, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(TimerWarmPressStyle())

            if cacheCleared {
                Text("✓ Cache cleared — the feed repopulates from GitHub on next visit")
                    .font(WarmInstrument.figures(11))
                    .foregroundColor(WarmInstrument.sportColor(.foundation))
            } else if !testMode.isEnabled {
                Text("Clear Activity Cache wipes the local activity feed cache; it repopulates from GitHub automatically.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkFaint)
            }

            WarmSettingsDivider()
            diagnosticsSection
        }
    }

    // MARK: - Diagnostics

    private var diagnosticsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                MonoLabel("DIAGNOSTICS", size: 9, color: WarmInstrument.inkFaint, tracking: 1.2)
                Spacer()
                Button { showDiagHelp = true } label: {
                    Image(systemName: "info.circle")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
                .buttonStyle(.plain)
                .sheet(isPresented: $showDiagHelp) { DiagnosticsHelpSheet() }

                Button {
                    UIPasteboard.general.string = diagnosticsText
                    Haptics.tap()
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
                .buttonStyle(.plain)
            }

            VStack(spacing: 0) {
                DiagGroup(
                    title: "ROUTING",
                    summary: "\(appStateLabel) · \(router.onboardingPhase)",
                    hasWarning: router.effectivePhase != router.onboardingPhase,
                    rows: [
                        ("appState",        appStateLabel),
                        ("onboardingPhase", "\(router.onboardingPhase)"),
                        ("effectivePhase",  "\(router.effectivePhase)"),
                    ]
                )
                diagDivider
                DiagGroup(
                    title: "AUTH",
                    summary: authManager.user?.login ?? "not signed in",
                    hasWarning: authManager.sessionExpired,
                    rows: [
                        ("sessionReady",   "\(authManager.isSessionReady)"),
                        ("sessionExpired", "\(authManager.sessionExpired)"),
                        ("login",          authManager.user?.login ?? "nil"),
                        ("lastLogin",      UserDefaults.standard.string(forKey: "lastOnboardingLogin") ?? "nil"),
                    ]
                )
                diagDivider
                DiagGroup(
                    title: "SYNC",
                    summary: authManager.selectedRepo ?? "no repo",
                    hasWarning: syncManager.syncError != nil,
                    rows: [
                        ("repo",       authManager.selectedRepo ?? "nil"),
                        ("hkGranted",  "\(syncManager.hkAuthorizationGranted)"),
                        ("lastSync",   syncManager.lastSyncDate.map { $0.formatted(.relative(presentation: .named)) } ?? "never"),
                        ("syncError",  syncManager.syncError ?? "none"),
                    ]
                )
                diagDivider
                DiagGroup(
                    title: "DEVICE",
                    summary: "iOS \(UIDevice.current.systemVersion) · build \(buildNumber)",
                    hasWarning: false,
                    rows: [
                        ("iOS",     UIDevice.current.systemVersion),
                        ("version", appVersion),
                        ("build",   buildNumber),
                    ]
                )
            }
            .padding(10)
            .background(WarmInstrument.desk)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    private var diagDivider: some View {
        Rectangle()
            .fill(WarmInstrument.headerRule)
            .frame(height: 1)
            .padding(.leading, 18)
    }

    private var appStateLabel: String {
        switch router.state {
        case .bootstrapping:          return "bootstrapping"
        case .unauthenticated:        return "unauthenticated"
        case .needsSetup(let login):  return "needsSetup(\(login))"
        case .multipleReposGranted:   return "multipleReposGranted"
        case .active:                 return "active"
        }
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
    }

    private var diagnosticsText: String {
        """
        appState:        \(appStateLabel)
        onboardingPhase: \(router.onboardingPhase)
        effectivePhase:  \(router.effectivePhase)
        sessionReady:    \(authManager.isSessionReady)
        sessionExpired:  \(authManager.sessionExpired)
        login:           \(authManager.user?.login ?? "nil")
        lastLogin:       \(UserDefaults.standard.string(forKey: "lastOnboardingLogin") ?? "nil")
        repo:            \(authManager.selectedRepo ?? "nil")
        hkGranted:       \(syncManager.hkAuthorizationGranted)
        lastSync:        \(syncManager.lastSyncDate.map { $0.formatted() } ?? "never")
        syncError:       \(syncManager.syncError ?? "none")
        iOS:             \(UIDevice.current.systemVersion)
        version:         \(appVersion)
        build:           \(buildNumber)
        """
    }

    // MARK: - Helpers

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
    }

    private func commitNameEdit() {
        let name = nameDraft.trimmingCharacters(in: .whitespaces)
        preferredName = name
        isEditingName = false
    }

    private func resetTestBranch() async {
        isResetting = true
        resetResult = nil
        defer { isResetting = false }

        do {
            try await testMode.resetTestBranch(authManager: authManager)
            resetResult = "✓ Test branch reset to main HEAD"
        } catch {
            resetResult = "✗ \(UserFacingError.friendlyMessage(for: error))"
        }
    }
}

// MARK: - Profile header

private struct SettingsProfileHeader: View {
    let user: GitHubUser?
    let preferredName: String
    let repo: String?

    var displayName: String {
        if !preferredName.isEmpty { return preferredName }
        return user?.login ?? "Athlete"
    }

    var body: some View {
        HStack(spacing: 16) {
            avatarView
                .frame(width: 60, height: 60)
                .clipShape(Circle())
                .overlay(Circle().strokeBorder(WarmInstrument.border, lineWidth: 1))

            VStack(alignment: .leading, spacing: 4) {
                Text(displayName)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(WarmInstrument.ink)

                if let login = user?.login {
                    Text("@\(login)")
                        .font(WarmInstrument.figures(11))
                        .foregroundColor(WarmInstrument.inkMuted)
                }

                if let repo {
                    Text(repo)
                        .font(WarmInstrument.figures(10))
                        .foregroundColor(WarmInstrument.inkFaint)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var avatarView: some View {
        if let avatarUrl = user?.avatarUrl, let url = URL(string: avatarUrl) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    placeholderAvatar
                }
            }
        } else {
            placeholderAvatar
        }
    }

    private var placeholderAvatar: some View {
        ZStack {
            Circle().fill(WarmInstrument.surfaceMuted)
            Image(systemName: "person.fill")
                .font(.system(size: 24, weight: .medium))
                .foregroundColor(WarmInstrument.inkMuted)
        }
    }
}

// MARK: - Warm settings atoms

private struct WarmSettingsSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            MonoLabel(title, size: 11, tracking: 1.4)

            WarmCard(padding: 16) {
                VStack(alignment: .leading, spacing: 14) {
                    content
                }
            }
        }
    }
}

private struct WarmSettingsDivider: View {
    var body: some View {
        Rectangle()
            .fill(WarmInstrument.headerRule)
            .frame(height: 1)
    }
}

private struct WarmSettingsToggleRow: View {
    let title: String
    let icon: String
    let iconColor: Color
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(iconColor)
                .frame(width: 22)

            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.ink)

            Spacer(minLength: 8)

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(WarmInstrument.accent)
        }
    }
}

private struct WarmSettingsInfoRow: View {
    let label: String
    let value: String
    var valueColor: Color = WarmInstrument.inkFaint
    var valueWeight: Font.Weight = .regular

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.ink)
            Spacer(minLength: 8)
            Text(value)
                .font(WarmInstrument.figures(12, weight: valueWeight))
                .foregroundColor(valueColor)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct DiagGroup: View {
    let title: String
    let summary: String
    let hasWarning: Bool
    let rows: [(String, String)]

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.spring(duration: 0.25, bounce: 0.1)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(WarmInstrument.inkFaint)
                        .frame(width: 12)
                    Text(title)
                        .font(WarmInstrument.monoLabel(10))
                        .foregroundColor(WarmInstrument.inkFaint)
                    if hasWarning {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 10))
                            .foregroundColor(WorkoutTimerWarm.amber)
                    }
                    Spacer()
                    if !isExpanded {
                        Text(summary)
                            .font(WarmInstrument.figures(10))
                            .foregroundColor(WarmInstrument.inkFaint)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .padding(.vertical, 7)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(rows, id: \.0) { key, value in
                        DiagRow(key: key, value: value)
                    }
                }
                .padding(.leading, 18)
                .padding(.bottom, 8)
            }
        }
    }
}

private struct DiagRow: View {
    let key: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(key)
                .font(WarmInstrument.monoLabel(10))
                .foregroundColor(WarmInstrument.inkFaint)
                .frame(width: 110, alignment: .leading)
            Text(value)
                .font(WarmInstrument.figures(11, weight: .bold))
                .foregroundColor(WarmInstrument.ink)
                .lineLimit(2)
        }
    }
}

private struct DiagnosticsHelpSheet: View {
    @Environment(\.dismiss) private var dismiss

    private struct Field {
        let key: String
        let description: String
        let values: [(String, String)]
    }

    private let fields: [Field] = [
        Field(
            key: "appState",
            description: "Top-level screen the app is showing.",
            values: [
                ("bootstrapping",     "Just launched — checking for a saved login"),
                ("unauthenticated",   "Not signed in — Login screen showing"),
                ("needsSetup(name)",  "Signed in but GitHub App not installed yet — Setup wizard showing"),
                ("active",            "Fully signed in — main tabs showing"),
            ]
        ),
        Field(
            key: "onboardingPhase",
            description: "Where you are in the first-run flow. Saved to disk.",
            values: [
                ("notStarted", "Splash screen showing (or not seen yet)"),
                ("hkPrompt",   "On the HealthKit connect screen"),
                ("reveal",     "On the intro reveal screen"),
                ("complete",   "All onboarding done — normal app"),
            ]
        ),
        Field(
            key: "effectivePhase",
            description: "Same as onboardingPhase, except returns 'complete' if sessionExpired is true — prevents onboarding modals from covering the re-auth screen.",
            values: []
        ),
        Field(
            key: "sessionReady",
            description: "True once the app has finished checking for a saved login on launch. Nothing knows if you're signed in until this is true.",
            values: []
        ),
        Field(
            key: "sessionExpired",
            description: "True if the server returned a 401. The 'session expired' overlay is showing.",
            values: []
        ),
        Field(
            key: "hkGranted",
            description: "True if you've tapped 'Connect Health' at any point. Does not confirm iOS granted access — just that you tapped the button.",
            values: []
        ),
        Field(
            key: "repo",
            description: "The GitHub repo being synced to.",
            values: []
        ),
        Field(
            key: "login",
            description: "Your signed-in GitHub username.",
            values: []
        ),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Paste the copied diagnostics text when reporting a bug — it gives a full snapshot of the app's state.")
                        .font(.system(size: 13))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .padding(.bottom, 4)

                    ForEach(fields, id: \.key) { field in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(field.key)
                                .font(WarmInstrument.monoLabel(12))
                                .foregroundColor(WarmInstrument.ink)

                            Text(field.description)
                                .font(.system(size: 13))
                                .foregroundColor(WarmInstrument.inkMuted)
                                .fixedSize(horizontal: false, vertical: true)

                            if !field.values.isEmpty {
                                VStack(alignment: .leading, spacing: 3) {
                                    ForEach(field.values, id: \.0) { value, meaning in
                                        HStack(alignment: .top, spacing: 8) {
                                            Text(value)
                                                .font(WarmInstrument.figures(11, weight: .bold))
                                                .foregroundColor(WarmInstrument.accent)
                                                .frame(minWidth: 110, alignment: .leading)
                                            Text(meaning)
                                                .font(.system(size: 12))
                                                .foregroundColor(WarmInstrument.inkFaint)
                                                .fixedSize(horizontal: false, vertical: true)
                                        }
                                    }
                                }
                                .padding(10)
                                .background(WarmInstrument.desk)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                        }

                        Rectangle()
                            .fill(WarmInstrument.headerRule)
                            .frame(height: 1)
                    }
                }
                .padding(20)
            }
            .background(WarmInstrument.paper.ignoresSafeArea())
            .navigationTitle("Diagnostics Guide")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(WarmInstrument.accent)
                }
            }
        }
    }
}

private struct WarmZoneStepper: View {
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>

    var body: some View {
        HStack {
            Text("\(label): \(value) bpm")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(Theme.ink)

            Spacer(minLength: 8)

            Stepper("", value: $value, in: range)
                .labelsHidden()
                .tint(WarmInstrument.accent)
        }
    }
}
