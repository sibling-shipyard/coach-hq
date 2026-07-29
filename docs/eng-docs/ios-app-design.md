# Coach HQ iOS App: Architecture & Design

This document outlines the architecture, roadmap, and design philosophy for the Coach HQ iOS app. 

The app is designed as a **silent, fast, native iOS utility** that serves as the bridge between Apple Health, the user's physical workouts, and the user's coaching GitHub repository. It does not replace the AI coaching intelligence (which lives in Manus) but rather provides the native sensors, timers, and data ingestion required to make the system seamless.

---

## 1. Identity & Design Philosophy

The iOS app is the on-device executor for Coach Phelps (the AI coach). It follows strict design boundaries:

- **Silent Utility:** No push notifications, no chat interface, no AI personality inside the app. Coach Phelps talks to the user via Manus. The app just moves data and runs timers.
- **Native Aesthetic:** Built entirely in SwiftUI using system colors, SF Symbols, and standard iOS typography. Fully supports Light and Dark mode without custom theming.
- **Offline-First:** While GitHub is the ultimate source of truth, the app caches data locally so it opens instantly and works in the gym with poor connectivity.
- **GitHub as Backend:** The app has no traditional backend or database. It authenticates via GitHub OAuth and reads/writes directly to the user's `coach-phelps` repository.

---

## 2. Roadmap & Phases

The app is being built in three distinct phases.

### Phase 1: Ingestion & Sync (Current)
*Goal: Replace Strava as the data ingestion pipeline.*

- **GitHub OAuth:** Secure authentication to the private repository.
- **HealthKit Sync:** Background and manual fetching of workouts (duration, calories, distance, HR samples).
- **Enrichment:** On-device computation of Heart Rate zones, mapping HealthKit sport types to coaching sport categories, and auto-generating sequential names (e.g., `Calisthenics #34: General`).
- **Badminton Scores:** An activity list view where users can tap a synced badminton session, paste raw match scores, see a live parsed preview, and commit the structured data to `ebadders_history.json`.

### Phase 2: Enhanced Workout Timer
*Goal: Port the web dashboard's timer to native iOS with hardware enhancements.*

- **Session Ingestion:** App reads `sessions/*.json` from the repository to load the day's prescribed workout. If no custom session exists, it falls back to default templates stored in the repo.
- **Native Timer Engine:** Re-implementation of the web timer logic (Prep → Work → Rest → Phase Transition).
- **Hardware Enhancements:**
  - **Haptics:** Taptic feedback on phase transitions (work to rest) so the user doesn't need to look at the screen.
  - **Live Activity:** iOS 16+ Lock Screen widget showing the current exercise, set, and countdown timer.
  - **Background Audio:** Beeps play even when the phone is locked.

### Phase 3: Native Dashboard
*Goal: Bring key analytical views into the app.*

- **Weekly Summary:** Port the web dashboard's weekly card (workouts completed, hours, badminton W/L record).
- **Quest Log:** Native view of `quest_log.md` progress.
- **Data Source:** Reads directly from `user_data/activities/hist/*.json` and `platform/plugins/badminton/data/badminton_match_data.json`.

### Future: Apple Watch Companion
- A WatchOS app that mirrors the active iOS timer.
- Buzzes the wrist on phase transitions.
- Shows current exercise and reps on the watch face.

---

## 3. Data Flow Architecture

The system uses a unidirectional data flow centered around the GitHub repository.

### HealthKit Sync Flow
1. User completes a workout (Apple Watch or Garmin → Apple Health).
2. iOS App wakes up (Background Delivery) or user opens the app.
3. App fetches the `HKWorkout` and associated `HKQuantitySample` (Heart Rate).
4. App maps data to the `Activity` JSON schema, computes HR zones, and assigns a name.
5. App commits the new `hk_YYYY-MM-DD_<type>_<num>.json` file to `user_data/activities/hist/` via GitHub Contents API.
6. App updates `user_data/activities/sync_state.json` with the incremented counters.

### Badminton Score Flow
1. User taps a synced badminton activity in the app.
2. User pastes raw scores (e.g., `Tony me vs Alston/Wei 21-18`).
3. App parses the text into structured W/L data and match arrays.
4. App commits a single tree update to GitHub containing:
   - Updated activity JSON (with formatted description).
   - Updated `training/ebadders_history.json` (new entry appended).

### Workout Timer Flow
1. App launches and fetches the latest `sessions/*.json` from GitHub.
2. User starts the timer.
3. Timer state is managed locally in SwiftUI.
4. (Optional) Upon completion, app could write a `completion_log.md` back to GitHub for Coach Phelps to review in the next session.

---

## 4. Technical Stack

- **Language:** Swift 5.9+
- **UI Framework:** SwiftUI
- **Authentication:** Shared in-app WKWebView OAuth via the coach-phelps-hq auth backend
  (`WebAuthPresenter` / `WebAuthBrowserStore` — see `github-auth.md` § iOS flow)
- **Health Data:** HealthKit (`HKSampleQueryDescriptor`)
- **API Client:** Custom lightweight `URLSession` wrapper for GitHub REST API (Contents, Git Data, Trees, Commits).
- **Minimum Target:** iOS 16.0 (required for modern Swift concurrency and Live Activities).

---

## References

[1] [Coach Phelps GitHub Repository](https://github.com/akash-suresh/coach-phelps)
[2] [Apple HealthKit Documentation](https://developer.apple.com/documentation/healthkit)
[3] [GitHub REST API Documentation](https://docs.github.com/en/rest)
