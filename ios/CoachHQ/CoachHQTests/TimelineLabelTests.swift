import XCTest
@testable import CoachHQ

/// Covers the operator-facing labels used by navigation and GitHub file operations.
final class TimelineLabelTests: XCTestCase {

    // MARK: - Navigation labels

    func testAppStateLabelsAreReadableAndNotSwiftTypeNames() {
        let cases: [(AppState, String)] = [
            (.bootstrapping, "launch"),
            (.unauthenticated, "sign in"),
            (.needsSetup(login: "alice"), "setup"),
            (.multipleReposGranted, "multiple repos"),
            (.active, "home"),
        ]
        for (state, expected) in cases {
            XCTAssertEqual(state.diagnosticViewName, expected,
                           "AppState.\(state) should produce '\(expected)'")
            XCTAssertFalse(state.diagnosticViewName.hasSuffix("View"),
                           "AppState.\(state) exposes a Swift type name: '\(state.diagnosticViewName)'")
        }
    }

    func testAppTabLabelsAreReadableAndNotSwiftTypeNames() {
        let cases: [(AppTab, String)] = [
            (.home, "home"),
            (.chat, "coach chat"),
            (.workouts, "workouts"),
            (.you, "settings"),
        ]
        for (tab, expected) in cases {
            XCTAssertEqual(tab.diagnosticViewName, expected,
                           "AppTab.\(tab) should produce '\(expected)'")
            XCTAssertFalse(tab.diagnosticViewName.hasSuffix("View"),
                           "AppTab.\(tab) exposes a Swift type name: '\(tab.diagnosticViewName)'")
        }
    }

    // MARK: - GitHub API labels

    /// Verifies the timeline event structure for file-based GitHub operations:
    /// the message is a short verb phrase; the repo path stays in metadata.
    func testGitHubFileOperationsStorePathInMetadataNotMessage() {
        let repoPaths = [
            "user_data/activities/sync_state.json",
            "user_data/activities/hist",
            "user_data/coach/profile.json",
        ]
        let operationLabels = ["list files", "read file", "upload blob", "save file"]

        for path in repoPaths {
            for label in operationLabels {
                let buffer = TimelineBuffer()
                buffer.addEvent(
                    category: "github.request",
                    message: label,
                    metadata: ["path": path, "outcome": "started"]
                )
                let event = buffer.getEvents().first!
                XCTAssertFalse(
                    event.message.contains("user_data"),
                    "Message '\(event.message)' contains a repo path — path must go in metadata"
                )
                XCTAssertFalse(
                    event.message.contains("/"),
                    "Message '\(event.message)' contains a path separator"
                )
                XCTAssertEqual(event.metadata["path"], path)
            }
        }
    }

    func testImplementationLabelsAreRejectedAsNavigationMessages() {
        // These implementation values must never be emitted as navigation messages.
        let bannedMessages = [
            "Listing user_data/activities/hist",
            "Reading user_data/activities/sync_state.json",
            "Uploading user_data/activities/hist/2024-01-01_run.json",
            "Saving user_data/hr/zones.json",
            "BootstrapView",
            "LoginView",
            "SetupView",
            "MultipleReposView",
            "MainTabView",
            "HomeView",
            "CoachChatView",
            "WorkoutListView",
            "SettingsView",
        ]

        // None of these appear in AppState / AppTab navigation labels.
        let allNavLabels = AppTab.allCases.map(\.diagnosticViewName) + [
            AppState.bootstrapping, .unauthenticated, .needsSetup(login: ""),
            .multipleReposGranted, .active,
        ].map(\.diagnosticViewName)

        for banned in bannedMessages {
            XCTAssertFalse(
                allNavLabels.contains(banned),
                "Banned label '\(banned)' still appears in navigation diagnosticViewName"
            )
        }
    }
}
