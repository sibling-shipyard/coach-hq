import Foundation

/// Local cache of activities synced from HealthKit, so the UI can list recent
/// activities and track which ones still need a description without round-tripping
/// to GitHub on every launch.
///
/// Stats fields (calories, HR, distance) are optional: entries written before
/// the fields existed decode as nil and are lazily backfilled by the list view.
struct SyncCacheEntry: Codable, Identifiable, Hashable {
    var id: String { fileName }

    var fileName: String
    var name: String
    var sportType: String
    var startDateLocal: String
    var elapsedTime: Int          // seconds
    var hasDescription: Bool

    // Inline stats for the activity feed (added with the UI polish; optional so
    // older cached entries keep decoding).
    var calories: Int?
    var averageHeartrate: Double?
    var maxHeartrate: Double?
    var distance: Double?         // meters

    /// Full activity payload, exactly as committed to GitHub (issue #131).
    /// Lets the detail view render and save without a Contents API read —
    /// which can 404/serve stale data for up to ~a minute after a branch
    /// reset + immediate Git Data API write. Optional so old entries decode.
    var activity: Activity?

    /// Convenience initializer from a full Activity payload.
    init(fileName: String, activity: Activity, hasDescription: Bool) {
        self.fileName = fileName
        self.name = activity.name
        self.sportType = activity.sportType
        self.startDateLocal = activity.startDateLocal
        self.elapsedTime = activity.elapsedTime
        self.hasDescription = hasDescription
        self.calories = activity.calories
        self.averageHeartrate = activity.averageHeartrate
        self.maxHeartrate = activity.maxHeartrate
        self.distance = activity.distance
        self.activity = activity
    }

    init(
        fileName: String,
        name: String,
        sportType: String,
        startDateLocal: String,
        elapsedTime: Int,
        hasDescription: Bool,
        calories: Int? = nil,
        averageHeartrate: Double? = nil,
        maxHeartrate: Double? = nil,
        distance: Double? = nil
    ) {
        self.fileName = fileName
        self.name = name
        self.sportType = sportType
        self.startDateLocal = startDateLocal
        self.elapsedTime = elapsedTime
        self.hasDescription = hasDescription
        self.calories = calories
        self.averageHeartrate = averageHeartrate
        self.maxHeartrate = maxHeartrate
        self.distance = distance
    }

    /// True if this entry predates the stats fields and needs a backfill fetch.
    var needsStatsBackfill: Bool {
        calories == nil && averageHeartrate == nil && (distance ?? 0) == 0
    }

    /// True if this entry predates full-payload caching (issue #131) — the list
    /// view backfills it opportunistically so detail opens become instant.
    var needsActivityBackfill: Bool {
        activity == nil
    }
}

/// Persists the synced-activities cache to UserDefaults as JSON.
enum SyncCache {
    static let userDefaultsKey = "synced_activities_cache"

    /// Entries older than this are evicted on save — the list only ever shows
    /// the last 7 days, so anything past 30 days is dead weight in UserDefaults.
    static let evictionDays = 30

    static func load() -> [SyncCacheEntry] {
        guard let data = UserDefaults.standard.data(forKey: userDefaultsKey) else { return [] }
        return (try? JSONDecoder().decode([SyncCacheEntry].self, from: data)) ?? []
    }

    static func save(_ entries: [SyncCacheEntry]) {
        guard let data = try? JSONEncoder().encode(evictStale(entries)) else { return }
        UserDefaults.standard.set(data, forKey: userDefaultsKey)
    }

    /// Removes the entire cache. The next backfill repopulates it from GitHub.
    static func clear() {
        UserDefaults.standard.removeObject(forKey: userDefaultsKey)
    }

    /// Inserts a new entry, or overwrites the existing one with the same `fileName`.
    static func upsert(_ entry: SyncCacheEntry) {
        var entries = load()
        if let idx = entries.firstIndex(where: { $0.fileName == entry.fileName }) {
            entries[idx] = entry
        } else {
            entries.append(entry)
        }
        save(entries)
    }

    /// Convenience: flips `hasDescription` for a cached entry after a successful save.
    static func markHasDescription(fileName: String, hasDescription: Bool = true) {
        var entries = load()
        guard let idx = entries.firstIndex(where: { $0.fileName == fileName }) else { return }
        entries[idx].hasDescription = hasDescription
        save(entries)
    }

    /// Updates the stats fields of a cached entry (backfill from full activity JSON).
    static func updateStats(fileName: String, activity: Activity) {
        var entries = load()
        guard let idx = entries.firstIndex(where: { $0.fileName == fileName }) else { return }
        entries[idx].calories = activity.calories
        entries[idx].averageHeartrate = activity.averageHeartrate
        entries[idx].maxHeartrate = activity.maxHeartrate
        entries[idx].distance = activity.distance
        entries[idx].activity = activity
        save(entries)
    }

    /// Replaces the cached full activity (and derived fields) after a local
    /// mutation — e.g. a just-saved description — so the cache stays the
    /// source of truth even while GitHub's Contents API is catching up.
    static func updateActivity(fileName: String, activity: Activity) {
        var entries = load()
        guard let idx = entries.firstIndex(where: { $0.fileName == fileName }) else { return }
        entries[idx].activity = activity
        entries[idx].hasDescription = !(activity.description ?? "").isEmpty
        entries[idx].calories = activity.calories
        entries[idx].averageHeartrate = activity.averageHeartrate
        entries[idx].maxHeartrate = activity.maxHeartrate
        entries[idx].distance = activity.distance
        save(entries)
    }

    /// Drops entries whose start date is older than `evictionDays`. Entries with
    /// unparseable dates are kept (conservative — never destroy data on a parse bug).
    private static func evictStale(_ entries: [SyncCacheEntry]) -> [SyncCacheEntry] {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current
        guard let cutoff = Calendar.current.date(byAdding: .day, value: -evictionDays, to: Date()) else {
            return entries
        }
        return entries.filter { entry in
            guard let date = formatter.date(from: entry.startDateLocal) else { return true }
            return date >= cutoff
        }
    }
}
