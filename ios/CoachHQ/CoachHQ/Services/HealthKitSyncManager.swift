import Foundation
import Combine
import HealthKit
import UserNotifications

/// Manages HealthKit data access, background delivery, and sync to GitHub.
@MainActor
class HealthKitSyncManager: ObservableObject {
    @Published var lastSyncDate: Date?
    @Published var isSyncing = false
    @Published var syncError: String?
    @Published var syncState: SyncState?

    /// Per-sport-type counts of activities committed in the most recent sync
    /// round (e.g. ["WeightTraining": 2, "Badminton": 1]). Empty when the last
    /// round found nothing new.
    @Published var lastRoundSynced: [String: Int] = [:]

    /// One-shot result of the most recent completed sync round, for UI toasts.
    /// Set exactly once per finished round (success or failure) with a fresh id.
    @Published var lastSyncResult: SyncResult?

    struct SyncResult: Equatable {
        enum Outcome: Equatable { case synced(Int), nothingNew, failed(String) }
        let outcome: Outcome
        let id: UUID
    }

    @Published var isHKObserverActive = false
    /// Human-readable description of the current sync stage, for display in SyncStepView.
    /// Empty when not syncing.
    @Published var syncProgressText: String = ""

    /// Persisted flag set only when the user explicitly connects HealthKit (pre-prompt
    /// "Connect Health" or Settings button). Distinct from `isHKObserverActive`, which
    /// is also set when we silently re-attempt authorization on launch for skipped users.
    var hkAuthorizationGranted: Bool {
        get { UserDefaults.standard.bool(forKey: "hkAuthorizationGranted") }
        set {
            objectWillChange.send()
            UserDefaults.standard.set(newValue, forKey: "hkAuthorizationGranted")
        }
    }

    private let healthStore = HKHealthStore()
    private var apiClient: GitHubAPIClient?
    private var widgetStore: WidgetSnapshotStore?
    private var observerRegistered = false

    // HealthKit data types we request access to
    private var readTypes: Set<HKObjectType> {
        let types: Set<HKObjectType> = [
            HKObjectType.workoutType(),
            HKQuantityType(.heartRate),
            HKQuantityType(.restingHeartRate),
            HKQuantityType(.heartRateVariabilitySDNN),
            HKQuantityType(.vo2Max),
            HKQuantityType(.stepCount),
            HKQuantityType(.activeEnergyBurned),
            HKCategoryType(.sleepAnalysis),
        ]
        return types
    }

    func configure(apiClient: GitHubAPIClient, widgetStore: WidgetSnapshotStore? = nil) {
        self.apiClient = apiClient
        self.widgetStore = widgetStore
        Task { await loadSyncState() }
    }

    func loadSyncState() async {
        guard let apiClient = apiClient else { return }
        syncState = try? await apiClient.readSyncState()
    }

    // MARK: - Authorization

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitError.notAvailable
        }

        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
    }

    // MARK: - Background Delivery

    /// Registers for background delivery of workout data.
    /// iOS will wake the app when new workouts are written to HealthKit.
    nonisolated func enableBackgroundDelivery() {
        let workoutType = HKObjectType.workoutType()

        healthStore.enableBackgroundDelivery(for: workoutType, frequency: .immediate) { success, error in
            if let error = error {
                print("Background delivery registration failed: \(error)")
            }
        }
    }

    /// Set to true once onboarding completes so background sync notifications fire normally.
    /// Kept false during onboarding to avoid "N activities synced" interrupting the flow.
    var syncNotificationsEnabled = false

    /// Authorizes HK, enables background delivery, and registers the observer in one shot.
    /// Safe to call from Settings when the user enables HealthKit after initially skipping.
    /// Note: notification permission is NOT requested here — it's deferred to after onboarding.
    func connectHealthKit() async {
        try? await requestAuthorization()
        enableBackgroundDelivery()
        setupWorkoutObserver()
        hkAuthorizationGranted = true
    }

    /// Registers an HKObserverQuery that fires whenever new workouts arrive in HealthKit,
    /// syncs them, and posts a local notification so the user knows Coach is aware.
    /// Guard prevents duplicate queries accumulating across cold launches.
    func setupWorkoutObserver() {
        guard !observerRegistered else { return }
        observerRegistered = true
        isHKObserverActive = true
        let workoutType = HKObjectType.workoutType()
        let query = HKObserverQuery(sampleType: workoutType, predicate: nil) { [weak self] _, completionHandler, error in
            guard error == nil else { completionHandler(); return }
            Task { @MainActor [weak self] in
                guard let self else { completionHandler(); return }
                await self.syncNewWorkouts()
                if case .synced(let n) = self.lastSyncResult?.outcome, n > 0,
                   self.syncNotificationsEnabled {
                    await self.postSyncNotification(count: n)
                }
                completionHandler()
            }
        }
        healthStore.execute(query)
    }

    /// Requests notification permission the first time the app runs (no-ops on subsequent launches).
    func requestNotificationPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
    }

    private func postSyncNotification(count: Int) async {
        let content = UNMutableNotificationContent()
        content.title = count == 1 ? "Session logged" : "\(count) sessions logged"
        content.body = "Coach is reviewing your latest workout."
        content.sound = .default
        content.userInfo = ["navigateTo": "chat"]
        let request = UNNotificationRequest(
            identifier: "hk-sync-latest",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    // MARK: - Sync

    /// Fetches new workouts since last sync and commits them to GitHub in a single commit.
    func syncNewWorkouts() async {
        guard let apiClient = apiClient else { return }
        guard !isSyncing else { return }

        isSyncing = true
        syncError = nil

        do {
            // sync_state.json doesn't exist on a fresh repo — treat .notFound as first sync.
            var syncState: SyncState
            do {
                syncState = try await apiClient.readSyncState()
            } catch let e as GitHubAPIError {
                guard case .notFound = e else { throw e }
                syncState = SyncState()
            }

            let since: Date
            if let ts = syncState.hkLastSynced, let date = ISO8601DateFormatter().date(from: ts) {
                since = date
            } else {
                // First sync — pull the last week of history.
                since = Calendar.current.date(byAdding: .day, value: -7, to: Date())!
            }

            let lookbackDays = max(1, Calendar.current.dateComponents([.day], from: since, to: Date()).day ?? 7)
            syncProgressText = "Gathering activities — last \(lookbackDays) day\(lookbackDays == 1 ? "" : "s")"

            let workouts = try await fetchWorkouts(since: since)
            guard !workouts.isEmpty else {
                syncProgressText = ""
                lastRoundSynced = [:]
                lastSyncDate = Date()
                lastSyncResult = SyncResult(outcome: .nothingNew, id: UUID())
                isSyncing = false
                return
            }

            syncProgressText = "Building commit (\(workouts.count) workout\(workouts.count == 1 ? "" : "s") found)"

            // hist/ directory doesn't exist until the first commit — treat 404 as empty.
            let existingFiles: [GitHubFileEntry]
            do {
                existingFiles = try await apiClient.listFiles(path: "user_data/activities/hist")
            } catch let e as GitHubAPIError {
                guard case .notFound = e else { throw e }
                existingFiles = []
            }
            var existingFileNames = Set(existingFiles.map { $0.name })
            var counters = syncState.counters ?? [:]

            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            var filesToCommit: [(path: String, data: Data)] = []
            var syncedForCache: [(fileName: String, activity: Activity)] = []

            for workout in workouts {
                let base = ActivityMapper.map(workout: workout)

                // Dedup against Strava files (YYYY-MM-DD_HHMMSS_<id>.json)
                let datePart = String(base.startDateLocal.prefix(10))
                let timePart = base.startDateLocal.dropFirst(11).prefix(8)
                    .replacingOccurrences(of: ":", with: "")
                if existingFiles.contains(where: { $0.name.hasPrefix("\(datePart)_\(timePart)_") }) { continue }

                // Fetch HR samples and compute stats + zones
                let hrSamples = (try? await fetchHeartRateSamples(for: workout)) ?? []
                let hrStats = ActivityMapper.computeHRStats(samples: hrSamples)
                let hrZones = hrSamples.isEmpty ? nil : ActivityMapper.computeHRZones(
                    samples: hrSamples, config: .current, duration: workout.duration
                )

                let withHR = Activity(
                    name: base.name,
                    sportType: base.sportType,
                    startDateLocal: base.startDateLocal,
                    elapsedTime: base.elapsedTime,
                    movingTime: base.movingTime,
                    calories: base.calories,
                    distance: base.distance,
                    totalElevationGain: base.totalElevationGain,
                    averageHeartrate: hrStats.average,
                    maxHeartrate: hrStats.max,
                    hasHeartrate: !hrSamples.isEmpty,
                    hrZones: hrZones,
                    description: base.description,
                    totalPhotoCount: 0,
                    averageSpeed: base.averageSpeed,
                    maxSpeed: base.maxSpeed,
                    deviceName: base.deviceName,
                    source: base.source,
                    activityId: base.activityId,
                    idStr: base.idStr
                )

                let named = ActivityNamer.assignName(activity: withHR, counters: &counters)

                // Cheap uuid-filename dedup: the uuid filename is deterministic,
                // so if this workout's uuid already appears in any committed
                // filename, it's already synced. Filename-only (no file reads).
                if let uuid = named.activityId,
                   existingFiles.contains(where: { $0.name.contains("_\(uuid).json") }) { continue }

                let fileName = ActivityNamer.fileName(for: named)
                if existingFileNames.contains(fileName) { continue }

                filesToCommit.append((path: "user_data/activities/hist/\(fileName)", data: try encoder.encode(named)))
                existingFileNames.insert(fileName)
                syncedForCache.append((fileName, named))
            }

            guard !filesToCommit.isEmpty else {
                syncProgressText = ""
                lastRoundSynced = [:]
                lastSyncDate = Date()
                lastSyncResult = SyncResult(outcome: .nothingNew, id: UUID())
                isSyncing = false
                return
            }

            // Include updated sync_state in the same commit
            syncState.counters = counters
            syncState.hkLastSynced = ISO8601DateFormatter().string(from: Date())
            filesToCommit.append((path: "user_data/activities/sync_state.json", data: try encoder.encode(syncState)))

            let n = filesToCommit.count - 1
            syncProgressText = "Pushing \(n) activit\(n == 1 ? "y" : "ies") to GitHub…"
            let commitFinishedAt = Date()
            try await apiClient.commitFiles(filesToCommit, message: "sync: HealthKit — \(n) activit\(n == 1 ? "y" : "ies")")

            // Freshly-synced HealthKit activities never have a description yet.
            var roundCounts: [String: Int] = [:]
            for (fileName, activity) in syncedForCache {
                SyncCache.upsert(SyncCacheEntry(fileName: fileName, activity: activity, hasDescription: false))
                roundCounts[activity.sportType, default: 0] += 1
            }
            lastRoundSynced = roundCounts

            self.syncState = syncState
            lastSyncDate = Date()
            syncProgressText = "Commit pushed — \(n) activit\(n == 1 ? "y" : "ies") saved"
            lastSyncResult = SyncResult(outcome: .synced(n), id: UUID())
            // Release the lock before the post-commit refresh so a second syncNewWorkouts()
            // call (e.g. from SyncStepView tapping Proceed) isn't blocked for up to 5 min.
            isSyncing = false

            // Home reads live snapshots from aggregate.json; the user-repo sync workflow
            // regenerates that file ~30s after this commit. Run in background — don't hold
            // isSyncing for this; it only affects the widget home cache, not the sync flow.
            let ws = widgetStore
            Task { await ws?.refreshAfterSync(since: commitFinishedAt) }
        } catch is CancellationError {
            // Task was cancelled (e.g. view torn down mid-sync) — not a real
            // failure; stay quiet instead of showing a scary "cancelled" error.
        } catch let error as NSError where error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
            // Same: URLSession-level cancellation, not a sync failure.
        } catch let apiError as GitHubAPIError where {
            if case .sessionNotReady = apiError { return true }
            return false
        }() {
            // Session not ready yet — silently ignore, same as WidgetSnapshotStore.
        } catch {
            let friendly = UserFacingError.friendlyMessage(for: error)
            syncError = friendly
            syncProgressText = ""
            lastSyncResult = SyncResult(outcome: .failed(friendly), id: UUID())
        }

        isSyncing = false
    }

    // MARK: - Cache backfill

    /// Reconciles the local `SyncCache` against what's already committed to
    /// `user_data/activities/hist` on GitHub, for activities from the last `daysBack` days.
    ///
    /// The cache is only ever populated as a side effect of `syncNewWorkouts()`
    /// committing *new* workouts — nothing backfills it from activities that were
    /// already synced before the cache existed (first launch after this feature
    /// shipped, a reinstall, etc). Without this, the Activities list looks nearly
    /// empty even though the underlying data is already on GitHub, because
    /// `hkLastSynced` has moved past those older activities and `syncNewWorkouts()`
    /// will never see them again.
    func backfillRecentCache(daysBack: Int = 7) async {
        guard let apiClient = apiClient else { return }
        guard let files = try? await apiClient.listFiles(path: "user_data/activities/hist") else { return }

        let cutoff = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? .distantPast
        let cachedNames = Set(SyncCache.load().map { $0.fileName })

        let candidates = files.filter { file in
            file.type == "file"
                && !cachedNames.contains(file.name)
                && (Self.date(fromHistoryFileName: file.name).map { $0 >= cutoff } ?? false)
        }

        for file in candidates {
            guard let activity = try? await apiClient.readActivity(fileName: file.name) else { continue }
            SyncCache.upsert(SyncCacheEntry(
                fileName: file.name,
                activity: activity,
                hasDescription: !(activity.description ?? "").isEmpty
            ))
        }
    }

    /// Extracts the `YYYY-MM-DD` embedded in a history filename — works for both
    /// the legacy Strava shape (`2026-07-01_095844_<id>.json`) and the HealthKit
    /// shape (`hk_2026-07-02_hit_run_34.json`).
    private static func date(fromHistoryFileName fileName: String) -> Date? {
        guard let range = fileName.range(of: #"\d{4}-\d{2}-\d{2}"#, options: .regularExpression) else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        return formatter.date(from: String(fileName[range]))
    }

    // MARK: - HealthKit Queries

    /// Fetches all workouts completed since a given date.
    private func fetchWorkouts(since startDate: Date) async throws -> [HKWorkout] {
        let predicate = HKQuery.predicateForSamples(
            withStart: startDate,
            end: Date(),
            options: .strictStartDate
        )
        let sortDescriptor = SortDescriptor(\HKWorkout.startDate, order: .forward)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(predicate)],
            sortDescriptors: [sortDescriptor]
        )
        return try await descriptor.result(for: healthStore)
    }

    /// Fetches heart rate samples for a specific workout.
    func fetchHeartRateSamples(for workout: HKWorkout) async throws -> [Double] {
        let hrType = HKQuantityType(.heartRate)
        let predicate = HKQuery.predicateForSamples(
            withStart: workout.startDate,
            end: workout.endDate,
            options: .strictStartDate
        )

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: hrType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    let hrValues = (samples as? [HKQuantitySample])?.map {
                        $0.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                    } ?? []
                    continuation.resume(returning: hrValues)
                }
            }
            self.healthStore.execute(query)
        }
    }

    // MARK: - Year Summary

    func fetchYearSummary() async -> YearSummary {
        let calendar = Calendar.current
        let now = Date()

        // Subtract 52 weeks, then snap to the Monday of that week so indices are stable.
        let anchor = calendar.date(byAdding: .weekOfYear, value: -52, to: now)!
        let windowStart = calendar.date(
            from: calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: anchor)
        ) ?? calendar.date(byAdding: .day, value: -364, to: now)!

        let predicate = HKQuery.predicateForSamples(withStart: windowStart, end: now, options: .strictStartDate)
        let sortDescriptor = SortDescriptor(\HKWorkout.startDate, order: .forward)
        let descriptor = HKSampleQueryDescriptor(predicates: [.workout(predicate)], sortDescriptors: [sortDescriptor])
        let workouts = (try? await descriptor.result(for: healthStore)) ?? []

        var sportCounts: [String: Int] = [:]
        var totalSeconds: Double = 0
        var weeklyDensity = [Int](repeating: 0, count: 52)
        var dailyActivity = [[Bool]](repeating: [Bool](repeating: false, count: 7), count: 52)
        var dailySport = [[String?]](repeating: [String?](repeating: nil, count: 7), count: 52)

        for workout in workouts {
            let sport = ActivityMapper.sportType(for: workout.workoutActivityType)
            sportCounts[sport, default: 0] += 1
            totalSeconds += workout.duration

            // Use elapsed days / 7 — dateComponents(.weekOfYear) returns the field (0–53),
            // not a difference, so it breaks when the window spans two calendar years.
            let daysElapsed = calendar.dateComponents([.day], from: windowStart, to: workout.startDate).day ?? 0
            let weekIndex = min(max(daysElapsed / 7, 0), 51)
            // weekday: 1=Sun…7=Sat; map Mon=0 … Sun=6
            let rawWeekday = calendar.component(.weekday, from: workout.startDate)
            let dayIndex = (rawWeekday + 5) % 7

            weeklyDensity[weekIndex] = min(weeklyDensity[weekIndex] + 1, 7)
            dailyActivity[weekIndex][dayIndex] = true
            if dailySport[weekIndex][dayIndex] == nil { dailySport[weekIndex][dayIndex] = sport }
        }

        let topSport = sportCounts.max(by: { $0.value < $1.value })?.key ?? "Other"
        return YearSummary(
            sessions: workouts.count,
            hours: totalSeconds / 3600,
            topSport: topSport,
            weeklyDensity: weeklyDensity,
            dailyActivity: dailyActivity,
            dailySport: dailySport,
            sportCounts: sportCounts
        )
    }
}

// MARK: - Year Summary

struct YearSummary {
    let sessions: Int
    let hours: Double
    let topSport: String
    let weeklyDensity: [Int]        // 52 values, 0–7 sessions/week
    let dailyActivity: [[Bool]]     // 52 weeks × 7 days
    let dailySport: [[String?]]     // 52 weeks × 7 days (sport type string)
    let sportCounts: [String: Int]  // raw counts for pre-selecting chips

    static let empty = YearSummary(
        sessions: 0, hours: 0, topSport: "Other",
        weeklyDensity: [Int](repeating: 0, count: 52),
        dailyActivity: [[Bool]](repeating: [Bool](repeating: false, count: 7), count: 52),
        dailySport: [[String?]](repeating: [String?](repeating: nil, count: 7), count: 52),
        sportCounts: [:]
    )
}

// MARK: - Errors

enum HealthKitError: Error, LocalizedError {
    case notAvailable
    case authorizationDenied

    var errorDescription: String? {
        switch self {
        case .notAvailable: return "HealthKit is not available on this device."
        case .authorizationDenied: return "HealthKit authorization was denied."
        }
    }
}
