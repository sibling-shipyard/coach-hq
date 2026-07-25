import Foundation
import Combine
import HealthKit

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

    private let healthStore = HKHealthStore()
    private var apiClient: GitHubAPIClient?
    private var widgetStore: WidgetSnapshotStore?

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

    // MARK: - Sync

    /// Fetches new workouts since last sync and commits them to GitHub in a single commit.
    func syncNewWorkouts() async {
        guard let apiClient = apiClient else { return }
        guard !isSyncing else { return }

        isSyncing = true
        syncError = nil

        do {
            var syncState = try await apiClient.readSyncState()

            let since: Date
            if let ts = syncState.hkLastSynced, let date = ISO8601DateFormatter().date(from: ts) {
                since = date
            } else {
                since = Calendar.current.date(byAdding: .day, value: -7, to: Date())!
            }

            let workouts = try await fetchWorkouts(since: since)
            guard !workouts.isEmpty else {
                lastRoundSynced = [:]
                lastSyncDate = Date()
                lastSyncResult = SyncResult(outcome: .nothingNew, id: UUID())
                isSyncing = false
                return
            }

            let existingFiles = try await apiClient.listFiles(path: "training/history")
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
                    source: base.source
                )

                let named = ActivityNamer.assignName(activity: withHR, counters: &counters)
                let fileName = ActivityNamer.fileName(for: named)
                if existingFileNames.contains(fileName) { continue }

                filesToCommit.append((path: "training/history/\(fileName)", data: try encoder.encode(named)))
                existingFileNames.insert(fileName)
                syncedForCache.append((fileName, named))
            }

            guard !filesToCommit.isEmpty else {
                lastRoundSynced = [:]
                lastSyncDate = Date()
                lastSyncResult = SyncResult(outcome: .nothingNew, id: UUID())
                isSyncing = false
                return
            }

            // Include updated sync_state in the same commit
            syncState.counters = counters
            syncState.hkLastSynced = ISO8601DateFormatter().string(from: Date())
            filesToCommit.append((path: "training/sync_state.json", data: try encoder.encode(syncState)))

            let n = filesToCommit.count - 1
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
            lastSyncResult = SyncResult(outcome: .synced(n), id: UUID())

            // New activities just landed on GitHub — the widget snapshot pipeline runs on the
            // next sync/build, but refreshing now picks up anything already regenerated and
            // keeps Home from showing a stale pre-sync snapshot longer than necessary.
            await widgetStore?.refresh(showSpinner: false)
        } catch is CancellationError {
            // Task was cancelled (e.g. view torn down mid-sync) — not a real
            // failure; stay quiet instead of showing a scary "cancelled" error.
        } catch let error as NSError where error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
            // Same: URLSession-level cancellation, not a sync failure.
        } catch {
            syncError = error.localizedDescription
            lastSyncResult = SyncResult(outcome: .failed(error.localizedDescription), id: UUID())
        }

        isSyncing = false
    }

    // MARK: - Cache backfill

    /// Reconciles the local `SyncCache` against what's already committed to
    /// `training/history` on GitHub, for activities from the last `daysBack` days.
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
        guard let files = try? await apiClient.listFiles(path: "training/history") else { return }

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
