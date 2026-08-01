import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
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
                authManager.signOut()
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
        }
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
