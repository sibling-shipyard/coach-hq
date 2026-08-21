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
    /// 0.0 → 1.0 real progress fraction for the onboarding sync bar.
    /// Updated at key checkpoints so the bar tracks actual work, not a timer.
    @Published var syncProgress: Double = 0

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

    /// How far back every sync re-scans HealthKit, regardless of `hk_last_synced`.
    ///
    /// A watch workout can reach the phone hours or days after it started, and the HealthKit
    /// query filters on *start* time. A watermark of "when we last ran" therefore steps
    /// straight over a late arrival and never looks back — the workout is lost for good.
    /// Re-scanning a fixed window costs one local HealthKit query and lets dedup drop what is
    /// already committed. It also gives multi-source copies (Garmin, Strava) a chance to land
    /// in the same batch, which is what makes cross-source dedup work at all.
    static let lookbackWindowDays = 14

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
    /// Pass `extraFiles` to fold additional files into the same commit (no current caller does -
    /// onboarding used to via a now-removed user_data/profile.md write, see B1). If there are no
    /// new workouts but `extraFiles` is non-empty, commits those files alone.
    func syncNewWorkouts(
        extraFiles: [(path: String, data: Data)] = [],
        importing: ImportRequest? = nil
    ) async {
        guard let apiClient = apiClient else { return }
        guard !isSyncing else { return }

        isSyncing = true
        syncError = nil
        syncProgress = 0.02

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
            if let importing {
                // Manual import (Health Settings): the athlete picked specific workouts, so
                // the window is whatever reaches the oldest of them, not the watermark.
                since = importing.since
            } else if let ts = syncState.hkLastSynced, let date = ISO8601DateFormatter().date(from: ts) {
                // Never trust the watermark alone — see `lookbackWindowDays`.
                let windowFloor = Calendar.current.date(
                    byAdding: .day, value: -Self.lookbackWindowDays, to: Date()
                )!
                since = min(date, windowFloor)
            } else {
                // First sync — pull the last year of history.
                since = Calendar.current.date(byAdding: .day, value: -365, to: Date())!
            }

            let lookbackDays = max(1, Calendar.current.dateComponents([.day], from: since, to: Date()).day ?? 7)
            let isFirstSync = importing == nil && lookbackDays > 30
            syncProgressText = isFirstSync
                ? "Scanning a year of HealthKit data…"
                : "Checking for new workouts…"
            syncProgress = 0.05

            var rawWorkouts = try await fetchWorkouts(since: since)
            if let importing {
                rawWorkouts = rawWorkouts.filter { importing.uuids.contains($0.uuid.uuidString) }
            }
            guard !rawWorkouts.isEmpty else {
                if !extraFiles.isEmpty {
                    // No new workouts but extra files need committing (e.g. profile on first sync).
                    syncProgressText = "Saving profile…"
                    try await apiClient.commitFiles(extraFiles, message: "onboarding: athlete profile")
                    syncProgressText = ""
                }
                syncProgress = 0
                lastRoundSynced = [:]
                lastSyncDate = Date()
                lastSyncResult = SyncResult(outcome: .nothingNew, id: UUID())
                isSyncing = false
                return
            }

            syncProgress = 0.08

            // hist/ directory doesn't exist until the first commit — treat 404 as empty.
            let existingFiles: [GitHubFileEntry]
            do {
                existingFiles = try await apiClient.listFiles(path: "user_data/activities/hist")
            } catch let e as GitHubAPIError {
                guard case .notFound = e else { throw e }
                existingFiles = []
            }
            // Narrow the dedup working set to files within the sync window.
            // listFiles returns the full hist/ directory; we only need recent files
            // since fetchWorkouts only returns workouts since `since`.
            let dedupeWindowStart = Calendar.current.date(byAdding: .day, value: -2, to: since) ?? since
            let recentFiles = existingFiles.filter {
                Self.date(fromHistoryFileName: $0.name).map { $0 >= dedupeWindowStart } ?? true
            }

            // existingFileNames uses the full list to avoid overwriting any committed file.
            var existingFileNames = Set(existingFiles.map { $0.name })

            // Dedup runs after the file list, not before it: picking a winner between
            // multi-source copies of one session needs to know which copy is already in
            // the repo, or a late-arriving higher-priority source commits a second file
            // for a session already in hist/. See WorkoutDeduplicator.selectWinners.
            let committedUUIDs = Set(existingFiles.compactMap { Self.uuid(fromHistoryFileName: $0.name) })
            let workouts = Self.deduplicate(rawWorkouts, committedUUIDs: committedUUIDs)
            syncProgressText = "\(workouts.count) workout\(workouts.count == 1 ? "" : "s") found — reading HR data…"
            let counterReferenceYear = syncState.counterYear
                ?? Self.year(fromISO8601: syncState.hkLastSynced)
                ?? Calendar.current.component(.year, from: Date())
            var counters = ActivityNamer.expandCounters(
                syncState.counters ?? [:],
                referenceYear: counterReferenceYear
            )

            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            var filesToCommit: [(path: String, data: Data)] = []
            var syncedForCache: [(fileName: String, activity: Activity)] = []

            let total = workouts.count
            for (index, workout) in workouts.enumerated() {
                syncProgress = 0.08 + 0.82 * Double(index + 1) / Double(total)
                syncProgressText = "Reading workout \(index + 1) of \(total)…"
                let base = ActivityMapper.map(workout: workout)

                // Dedup against Strava files (YYYY-MM-DD_HHMMSS_<id>.json)
                let datePart = String(base.startDateLocal.prefix(10))
                let timePart = base.startDateLocal.dropFirst(11).prefix(8)
                    .replacingOccurrences(of: ":", with: "")
                if recentFiles.contains(where: { $0.name.hasPrefix("\(datePart)_\(timePart)_") }) { continue }

                // Every dedup check that can run on `base` runs here, before the HR samples
                // are read and before assignName() advances a counter. The sync window
                // deliberately re-scans days that are already synced, so a check that fires
                // later would burn a HealthKit query per already-committed workout and skip a
                // name number on every round — leaving permanent gaps in "WeightTraining #N".
                // The uuid filename is deterministic (ADR 0014), so it is known from `base`.
                if let uuid = base.activityId {
                    if existingFileNames.contains(ActivityNamer.fileName(for: base)) { continue }
                    if recentFiles.contains(where: { $0.name.contains("_\(uuid).json") }) { continue }
                }

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
                    sourceApp: base.sourceApp,
                    activityId: base.activityId,
                    idStr: base.idStr
                )

                let named = ActivityNamer.assignName(activity: withHR, counters: &counters)

                // Safety net for the slug fallback path, whose filename depends on the
                // assigned name and so cannot be known before this point. Workouts with a
                // uuid were already cleared above.
                let fileName = ActivityNamer.fileName(for: named)
                if existingFileNames.contains(fileName) { continue }

                filesToCommit.append((path: "user_data/activities/hist/\(fileName)", data: try encoder.encode(named)))
                existingFileNames.insert(fileName)
                syncedForCache.append((fileName, named))
            }

            guard !filesToCommit.isEmpty else {
                if !extraFiles.isEmpty {
                    // All workouts were deduped but extra files still need committing.
                    syncProgressText = "Saving profile…"
                    try await apiClient.commitFiles(extraFiles, message: "onboarding: athlete profile")
                    syncProgressText = ""
                }
                lastRoundSynced = [:]
                lastSyncDate = Date()
                lastSyncResult = SyncResult(outcome: .nothingNew, id: UUID())
                isSyncing = false
                return
            }

            // Include updated sync_state and any extra files in the same commit
            let flattened = ActivityNamer.flattenCounters(counters)
            syncState.counters = flattened.flat
            syncState.counterYear = flattened.latestYear
            syncState.hkLastSynced = ISO8601DateFormatter().string(from: Date())
            filesToCommit.append((path: "user_data/activities/sync_state.json", data: try encoder.encode(syncState)))
            filesToCommit.append(contentsOf: extraFiles)

            let n = filesToCommit.count - 1 - extraFiles.count
            syncProgressText = "Uploading \(n) workout\(n == 1 ? "" : "s") to GitHub…"
            syncProgress = 0.93
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
            syncProgressText = ""
            syncProgress = 0.97
            lastSyncResult = SyncResult(outcome: .synced(n), id: UUID())
            // Release the lock before the post-commit refresh so a second syncNewWorkouts()
            // call (e.g. from SyncStepView tapping Proceed) isn't blocked for up to 5 min.
            isSyncing = false

            // Home reads live snapshots from dashboard_snapshot.json; the user-repo sync workflow
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

    private static func year(fromISO8601 string: String?) -> Int? {
        guard let string, let date = ISO8601DateFormatter().date(from: string) else { return nil }
        return Calendar.current.component(.year, from: date)
    }

    /// Extracts the canonical uuid from a `hk_<date>_<uuid>.json` history filename.
    /// Returns nil for Strava-era and slug-named files, which carry no uuid.
    private static func uuid(fromHistoryFileName fileName: String) -> String? {
        guard fileName.hasPrefix("hk_"), fileName.hasSuffix(".json") else { return nil }
        let stem = String(fileName.dropLast(".json".count))
        guard let candidate = stem.split(separator: "_").last else { return nil }
        // Normalised through UUID so the comparison against `workout.uuid.uuidString`
        // can never miss on casing.
        return UUID(uuidString: String(candidate))?.uuidString
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

    // MARK: - Manual import (Health Settings)

    /// Restricts a sync round to workouts the athlete picked by hand, instead of whatever
    /// the automatic window turns up. Everything else about the round is unchanged — same
    /// dedup, same naming, same atomic commit.
    struct ImportRequest: Equatable {
        let uuids: Set<String>
        /// Query floor. Must reach the oldest workout being imported.
        let since: Date
    }

    /// One real-world session as the Health Settings list shows it — not one HealthKit
    /// record. Garmin and Strava mirror the same session into HealthKit, so a ride can exist
    /// two or three times; the list shows it once, with every app that recorded it.
    struct HealthImportRow: Identifiable, Equatable {
        enum State: Equatable {
            /// A file for one of this session's uuids is committed in `hist/`.
            case synced
            /// Nothing committed for it; the athlete can import it.
            case notSynced
            /// The day holds committed files that carry no uuid (legacy slug or Strava-era
            /// names), so we cannot tell whether this session is one of them. Import is
            /// blocked rather than risk a duplicate.
            case unknown
        }

        /// The winning recording's uuid — the one import commits.
        let id: String
        let sportType: String
        /// The winner's start and duration. Sources disagree by seconds; we show what we commit.
        let start: Date
        let duration: TimeInterval
        /// Every app that recorded this session, winner first (e.g. ["Apple Watch", "Garmin"]).
        let sources: [String]
        let state: State
    }

    /// Lists recent HealthKit workouts with their sync state, for the Health Settings screen.
    ///
    /// Read-only: one local HealthKit query plus the `hist/` file listing, no commits. The
    /// synced test is the uuid embedded in the committed filename (ADR 0014), so it needs no
    /// file contents.
    ///
    /// Returns nil when either read fails. An empty list means "no workouts"; the screen has to
    /// be able to tell those apart, because a failed listing would otherwise render as every
    /// workout being unsynced and invite the athlete to import duplicates.
    func loadHealthImportRows(daysBack: Int = 90) async -> [HealthImportRow]? {
        guard let apiClient = apiClient else { return nil }
        let since = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        guard let rawWorkouts = try? await fetchWorkouts(since: since) else { return nil }

        let existingFiles: [GitHubFileEntry]
        do {
            existingFiles = try await apiClient.listFiles(path: "user_data/activities/hist")
        } catch let e as GitHubAPIError {
            // hist/ not existing yet is a real, empty answer — anything else is a failed read.
            guard case .notFound = e else { return nil }
            existingFiles = []
        } catch {
            return nil
        }

        let committedUUIDs = Set(existingFiles.compactMap { Self.uuid(fromHistoryFileName: $0.name) })
        // Days that hold a committed file with no uuid in its name — pre-ADR-0014 slug names
        // and Strava-era history. We can't match those to a HealthKit workout, so every
        // session on such a day is `.unknown` rather than a false "not synced".
        let calendar = Calendar.current
        let ambiguousDays = Set(
            existingFiles
                .filter { Self.uuid(fromHistoryFileName: $0.name) == nil }
                .compactMap { Self.date(fromHistoryFileName: $0.name) }
                .map { calendar.startOfDay(for: $0) }
        )

        // Source names stay out of DedupCandidate — dedup does not need them, and the type
        // is kept to the fields it does. Look them back up by uuid when building the rows.
        let sourceNames = Dictionary(
            rawWorkouts.map { ($0.uuid.uuidString, $0.sourceRevision.source.name) },
            uniquingKeysWith: { first, _ in first }
        )

        return WorkoutDeduplicator.cluster(Self.dedupCandidates(rawWorkouts, committedUUIDs: committedUUIDs))
            .map { cluster in
                let winner = cluster.winner
                let state: HealthImportRow.State
                if cluster.isSynced {
                    state = .synced
                } else if ambiguousDays.contains(calendar.startOfDay(for: winner.start)) {
                    state = .unknown
                } else {
                    state = .notSynced
                }
                return HealthImportRow(
                    id: winner.uuid,
                    sportType: winner.sportType,
                    start: winner.start,
                    duration: winner.duration,
                    sources: Self.distinct(cluster.all.compactMap { sourceNames[$0.uuid] }),
                    state: state
                )
            }
            .sorted { $0.start > $1.start }
    }

    /// Drops repeats while keeping first-seen order — two recordings from the same app
    /// should read "Garmin", not "Garmin + Garmin".
    private static func distinct(_ names: [String]) -> [String] {
        var seen = Set<String>()
        return names.filter { seen.insert($0).inserted }
    }

    /// Commits one workout the athlete picked from the Health Settings list.
    func importWorkout(_ row: HealthImportRow) async {
        await syncNewWorkouts(
            importing: ImportRequest(
                uuids: [row.id],
                // A minute below the start, so `.strictStartDate` cannot miss it on a
                // boundary.
                since: row.start.addingTimeInterval(-60)
            )
        )
    }

    // MARK: - Multi-source dedup

    /// Removes duplicate recordings of the same session from a batch of HKWorkouts.
    ///
    /// Thin adapter over `WorkoutDeduplicator`, which holds the rules in a HealthKit-free
    /// form so they can be verified by `ios/scripts/verify_workout_dedup.swift`.
    ///
    /// Pass `committedUUIDs` (uuids already present in `hist/` filenames) so a copy already
    /// in the repo outranks a higher-priority source that shows up in a later round.
    static func deduplicate(_ workouts: [HKWorkout], committedUUIDs: Set<String> = []) -> [HKWorkout] {
        let winners = Set(
            WorkoutDeduplicator.selectWinners(dedupCandidates(workouts, committedUUIDs: committedUUIDs))
        )
        // Re-sort by startDate so ActivityNamer assigns counters in chronological order,
        // matching the invariant in engine/scripts/migrate_activity_naming.py.
        return workouts
            .filter { winners.contains($0.uuid.uuidString) }
            .sorted { $0.startDate < $1.startDate }
    }

    /// Reduces HKWorkouts to the fields the dedup rules use.
    static func dedupCandidates(
        _ workouts: [HKWorkout],
        committedUUIDs: Set<String>
    ) -> [DedupCandidate] {
        workouts.map { workout in
            DedupCandidate(
                uuid: workout.uuid.uuidString,
                sportType: ActivityMapper.sportType(for: workout.workoutActivityType),
                start: workout.startDate,
                end: workout.endDate,
                sourcePriority: ActivityMapper.sourcePriority(
                    bundleId: workout.sourceRevision.source.bundleIdentifier
                ),
                isCommitted: committedUUIDs.contains(workout.uuid.uuidString)
            )
        }
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
        let rawWorkouts = (try? await descriptor.result(for: healthStore)) ?? []
        let workouts = Self.deduplicate(rawWorkouts)

        var sportCounts: [String: Int] = [:]
        var totalSeconds: Double = 0
        var weeklyDensity = [Int](repeating: 0, count: 52)
        var dailyActivity = [[Bool]](repeating: [Bool](repeating: false, count: 7), count: 52)
        var dailySport = [[String?]](repeating: [String?](repeating: nil, count: 7), count: 52)
        var sportHours: [String: Double] = [:]
        var monthlySecs = [Double](repeating: 0, count: 12)
        var monthlySportCounts = [[String: Int]](repeating: [:], count: 12)

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

            sportHours[sport, default: 0] += workout.duration / 3600.0
            let monthIndex = min(11, max(0, calendar.dateComponents([.month], from: windowStart, to: workout.startDate).month ?? 0))
            monthlySecs[monthIndex] += workout.duration
            monthlySportCounts[monthIndex][sport, default: 0] += 1
        }

        let topSport = sportCounts.max(by: { $0.value < $1.value })?.key ?? "Other"

        let monthlyHours: [MonthStat] = (0..<12).map { i in
            MonthStat(
                hours: monthlySecs[i] / 3600.0,
                topSport: monthlySportCounts[i].max(by: { $0.value < $1.value })?.key
            )
        }

        var longestStreak = 0
        var currentStreak = 0
        for week in 0..<52 {
            for day in 0..<7 {
                if dailyActivity[week][day] {
                    currentStreak += 1
                    longestStreak = max(longestStreak, currentStreak)
                } else {
                    currentStreak = 0
                }
            }
        }

        var dayTotals = [Int](repeating: 0, count: 7)
        for week in 0..<52 {
            for day in 0..<7 {
                if dailyActivity[week][day] { dayTotals[day] += 1 }
            }
        }
        let mostActiveDayOfWeek: Int = dayTotals.allSatisfy({ $0 == 0 })
            ? -1
            : (dayTotals.indices.max(by: { dayTotals[$0] < dayTotals[$1] }) ?? -1)

        return YearSummary(
            sessions: workouts.count,
            hours: totalSeconds / 3600,
            topSport: topSport,
            weeklyDensity: weeklyDensity,
            dailyActivity: dailyActivity,
            dailySport: dailySport,
            sportCounts: sportCounts,
            sportHours: sportHours,
            monthlyHours: monthlyHours,
            longestStreak: longestStreak,
            mostActiveDayOfWeek: mostActiveDayOfWeek
        )
    }
}

// MARK: - Year Summary

struct MonthStat {
    let hours: Double
    let topSport: String?
}

struct YearSummary {
    let sessions: Int
    let hours: Double
    let topSport: String
    let weeklyDensity: [Int]        // 52 values, 0–7 sessions/week
    let dailyActivity: [[Bool]]     // 52 weeks × 7 days
    let dailySport: [[String?]]     // 52 weeks × 7 days (sport type string)
    let sportCounts: [String: Int]  // raw counts for pre-selecting chips
    let sportHours: [String: Double]        // hours per sport type
    let monthlyHours: [MonthStat]           // 12 months, oldest first
    let longestStreak: Int                  // consecutive active days
    let mostActiveDayOfWeek: Int            // 0=Mon…6=Sun, -1 if no data

    static let empty = YearSummary(
        sessions: 0, hours: 0, topSport: "Other",
        weeklyDensity: [Int](repeating: 0, count: 52),
        dailyActivity: [[Bool]](repeating: [Bool](repeating: false, count: 7), count: 52),
        dailySport: [[String?]](repeating: [String?](repeating: nil, count: 7), count: 52),
        sportCounts: [:],
        sportHours: [:],
        monthlyHours: [MonthStat](repeating: MonthStat(hours: 0, topSport: nil), count: 12),
        longestStreak: 0,
        mostActiveDayOfWeek: -1
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
