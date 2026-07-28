import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @ObservedObject var testMode = TestModeManager.shared
    @AppStorage(Theme.darkModeKey) private var darkModeEnabled = false
    @AppStorage(HRZoneConfig.zone1UpperKey) private var zone1Upper = HRZoneConfig.defaultZone1Upper
    @AppStorage(HRZoneConfig.zone2UpperKey) private var zone2Upper = HRZoneConfig.defaultZone2Upper
    @AppStorage(HRZoneConfig.zone3UpperKey) private var zone3Upper = HRZoneConfig.defaultZone3Upper
    @AppStorage(HRZoneConfig.zone4UpperKey) private var zone4Upper = HRZoneConfig.defaultZone4Upper

    @State private var isResetting = false
    @State private var resetResult: String?
    @State private var hrZonesExpanded = false
    @State private var cacheCleared = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    accountSection
                    appearanceSection
                    developerSection
                    hrZonesSection
                    aboutSection
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 32)
            }
            .background(WarmInstrument.desk.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        WarmSettingsSection(title: "Account") {
            if let user = authManager.user {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(WarmInstrument.surfaceMuted)
                            .frame(width: 44, height: 44)
                        Image(systemName: "person.fill")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundColor(WarmInstrument.inkMuted)
                    }

                    VStack(alignment: .leading, spacing: 3) {
                        Text(user.login)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(Theme.ink)
                        if let repo = authManager.selectedRepo {
                            Text(repo)
                                .font(WarmInstrument.figures(11))
                                .foregroundColor(WarmInstrument.inkFaint)
                        }
                    }
                }

                WarmSettingsDivider()
            }

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

    // MARK: - Developer

    private var developerSection: some View {
        WarmSettingsSection(title: "Developer") {
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

    // MARK: - Heart rate zones

    private var hrZonesSection: some View {
        WarmSettingsSection(title: "Heart Rate Zones") {
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

    // MARK: - About

    private var aboutSection: some View {
        WarmSettingsSection(title: "About") {
            WarmSettingsInfoRow(label: "Version", value: appVersion)
            WarmSettingsDivider()
            WarmSettingsInfoRow(label: "Architecture", value: "GitHub as Backend")
            WarmSettingsDivider()
            WarmSettingsInfoRow(
                label: "Target Branch",
                value: testMode.targetBranch,
                valueColor: testMode.isEnabled ? WorkoutTimerWarm.amber : WarmInstrument.inkFaint,
                valueWeight: testMode.isEnabled ? .bold : .regular
            )
        }
    }

    /// Reads the real version from the bundle so Settings can never drift from
    /// the shipped MARKETING_VERSION / build number.
    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    private func resetTestBranch() async {
        isResetting = true
        resetResult = nil
        defer { isResetting = false }

        do {
            try await testMode.resetTestBranch(authManager: authManager)
            resetResult = "✓ Test branch reset to main HEAD"
        } catch {
            resetResult = "✗ \(error.localizedDescription)"
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
