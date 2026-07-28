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
            Form {
                // Account Section
                Section {
                    if let user = authManager.user {
                        HStack {
                            Image(systemName: "person.circle.fill")
                                .font(.title2)
                                .foregroundColor(Theme.accentGreen)
                            VStack(alignment: .leading) {
                                Text(user.login)
                                    .fontWeight(.medium)
                                if let repo = authManager.selectedRepo {
                                    Text(repo)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }

                    Button("Sign Out", role: .destructive) {
                        authManager.signOut()
                    }
                } header: {
                    SectionHeader("Account")
                }

                // Appearance Section
                Section {
                    Toggle(isOn: $darkModeEnabled) {
                        Label {
                            Text("Dark Mode")
                        } icon: {
                            Image(systemName: darkModeEnabled ? "moon.fill" : "sun.max.fill")
                                .foregroundColor(darkModeEnabled ? .indigo : Theme.attentionOrange)
                        }
                    }
                    .tint(Theme.accentGreen)
                } header: {
                    SectionHeader("Appearance")
                } footer: {
                    Text("The app is designed for light mode, matching Coach HQ.")
                }

                // Test Mode Section
                Section {
                    Toggle("Test Mode", isOn: $testMode.isEnabled)
                        .tint(Theme.accentGreen)

                    if testMode.isEnabled {
                        HStack {
                            Image(systemName: "arrow.triangle.branch")
                                .foregroundColor(Theme.attentionOrange)
                            Text("Syncing to: **test/sync**")
                        }
                        .font(.subheadline)

                        Button(action: { Task { await resetTestBranch() } }) {
                            HStack {
                                if isResetting {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                                Text(isResetting ? "Resetting..." : "Reset Test Branch")
                            }
                        }
                        .disabled(isResetting)

                        if let resetResult {
                            Text(resetResult)
                                .font(.caption)
                                .foregroundColor(resetResult.contains("✓") ? Theme.accentGreen : .red)
                        }

                        Text("Deletes test/sync and recreates it from main HEAD. All test data is wiped.")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    Button(role: .destructive) {
                        SyncCache.clear()
                        cacheCleared = true
                    } label: {
                        Label("Clear Activity Cache", systemImage: "trash")
                    }

                    if cacheCleared {
                        Text("✓ Cache cleared — the feed repopulates from GitHub on next visit")
                            .font(.caption)
                            .foregroundColor(Theme.accentGreen)
                    }
                } header: {
                    SectionHeader("Developer")
                } footer: {
                    if !testMode.isEnabled {
                        Text("Enable Test Mode to sync to a test branch instead of main. Clear Activity Cache wipes the local activity feed cache; it repopulates from GitHub automatically.")
                    }
                }

                // HR Zones Section (collapsible)
                Section {
                    DisclosureGroup(isExpanded: $hrZonesExpanded) {
                        Stepper("Zone 1 upper: \(zone1Upper) bpm", value: $zone1Upper, in: 100...160)
                        Stepper("Zone 2 upper: \(zone2Upper) bpm", value: $zone2Upper, in: 120...170)
                        Stepper("Zone 3 upper: \(zone3Upper) bpm", value: $zone3Upper, in: 140...180)
                        Stepper("Zone 4 upper: \(zone4Upper) bpm", value: $zone4Upper, in: 150...200)
                        Text("Zone 5: above \(zone4Upper) bpm")
                            .foregroundColor(.secondary)
                    } label: {
                        Label {
                            HStack {
                                Text("Heart Rate Zones")
                                Spacer()
                                Text("\(zone1Upper)/\(zone2Upper)/\(zone3Upper)/\(zone4Upper)")
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundColor(.secondary)
                            }
                        } icon: {
                            Image(systemName: "heart.fill")
                                .foregroundColor(Theme.heartRateColor)
                        }
                    }
                    .tint(Theme.accentGreen)
                } header: {
                    SectionHeader("Heart Rate Zones")
                }

                // About Section
                Section {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(appVersion)
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Architecture")
                        Spacer()
                        Text("GitHub as Backend")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Target Branch")
                        Spacer()
                        Text(testMode.targetBranch)
                            .foregroundColor(testMode.isEnabled ? Theme.attentionOrange : .secondary)
                            .fontWeight(testMode.isEnabled ? .semibold : .regular)
                    }
                } header: {
                    SectionHeader("About")
                }
            }
            .navigationTitle("Settings")
            .tint(Theme.accentGreen)
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
