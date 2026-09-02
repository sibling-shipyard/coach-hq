import Sentry
import SwiftUI

/// Native Coach Chat — Warm Instrument continuous landing (`Coach Chat Mobile.dc.html` Turn 1).
///
/// **Wireup checklist (Skanda):**
/// 1. `loadThreads()` — API returns seeded today thread on new-day open; drop preview fallback.
/// 3. `chips(for:)` — map coach message metadata from API instead of `CoachChatPreviewData.chipsByMessageId`.
/// 4. `showSignature(for:)` — server flag on unprompted morning-read messages only.
/// 5. `historyThreads` — enforce 7-day window server-side; client already groups by `dayOffset`.
struct CoachChatView: View {
    @EnvironmentObject private var authManager: GitHubAuthManager
    @EnvironmentObject private var syncManager: HealthKitSyncManager
    @Binding private var requestedProactiveRoute: CoachMessageRoute?

    @State private var apiClient: CoachChatAPIClient?
    @State private var threads: [ChatThread] = []
    @State private var activeThreadId: String?
    @State private var draft = ""
    @State private var threadsLoading = true
    @State private var sending = false
    @State private var profileComplete = false
    @State private var errorMessage: String?
    @State private var showErrorDialog = false
    @State private var showHistorySheet = false
    // A5: shown when the server detected this thread's repo state changed since we last saw it
    // (most likely a session was wrapped on another device) - mirrors web's toast.info() in
    // CoachChat.tsx. The context refresh itself already happened server-side by the time this
    // fires; this is purely the "here's why" explanation web athletes already get.
    @State private var toast: Toast?
    @State private var openedActivity: SyncCacheEntry?
    @FocusState private var composerFocused: Bool
    @State private var keyboardVisible = false
    @AppStorage("chatHasUnread") private var chatHasUnread = false
    @AppStorage("chatWelcomeShown") private var chatWelcomeShown = false

    /// Real challenge day, fetched once per session from profile.json (see loadHeaderContext()
    /// below) - nil until that fetch resolves, at which point headerContext below reflects it.
    @State private var liveDayNumber: Int?

    init(requestedProactiveRoute: Binding<CoachMessageRoute?>) {
        _requestedProactiveRoute = requestedProactiveRoute
    }

    /// Day label comes from a live fetch of profile.json's coach_since (same math as web's
    /// coachDayNumber() in coachChatModel.ts). Day-only header now (week label dropped, see
    /// issue #244). `liveDayNumber == nil` genuinely means no anchor has resolved yet (pre-FSP,
    /// per ADR 0018) - shows D-0 honestly
    /// instead of falling through to the stale preview constant.
    private var headerContext: CoachChatHeaderContext {
        CoachChatHeaderContext(
            dayLabel: liveDayNumber.map { "D-\($0)" } ?? "D-0",
            secondaryLabel: nil,
            statusSuffix: nil
        )
    }

    private static func challengeDayNumber(startDate: String) -> Int? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = .current
        guard let start = formatter.date(from: startDate) else { return nil }
        let calendar = Calendar.current
        let days = calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: start),
            to: calendar.startOfDay(for: Date())
        ).day ?? 0
        return max(1, days + 1)
    }

    private func loadHeaderContext() async {
        guard liveDayNumber == nil else { return } // fetched once per session, not on every re-trigger
        let client = GitHubAPIClient(authManager: authManager)
        guard let startDate = try? await client.readCoachDayAnchorDate() else { return }
        liveDayNumber = Self.challengeDayNumber(startDate: startDate)
    }

    private var usingPreviewShell: Bool {
        !threadsLoading && threads.filter { $0.status != .deleted }.isEmpty
    }

    /// Empty today landing when the API has no threads — UI only, never sent to the server.
    private var emptyTodayShell: ChatThread {
        ChatThread(
            id: CoachChatPreviewData.previewTodayThreadId,
            dayOffset: 0,
            title: "Today's thread",
            preview: "",
            ageLabel: "NOW",
            status: .active,
            messages: []
        )
    }

    private var historyThreads: [ChatThread] {
        let live = threads.filter { $0.status != .deleted }
        return live.isEmpty ? CoachChatPreviewData.historyThreads : live
    }

    private var todayThread: ChatThread? {
        threads.first { $0.dayOffset == 0 && $0.status != .deleted }
    }

    // Despite the name (kept for minimal diff against existing call sites), this is not
    // strictly "yesterday" - matches web's pickupThread and the doc's stated rule: the newest
    // still-open thread from any prior day, not just dayOffset == 1. threads is newest-first
    // (per the API), so .first(where:) already picks the most recent match.
    private var yesterdayThread: ChatThread? {
        if let live = threads.first(where: { $0.dayOffset > 0 && $0.status == .active && !$0.messages.isEmpty }) {
            return live
        }
        if usingPreviewShell {
            return CoachChatPreviewData.historyThreads.first { $0.dayOffset == 1 }
        }
        return nil
    }

    private var displayThread: ChatThread {
        if let id = activeThreadId {
            if let thread = threads.first(where: { $0.id == id }) { return thread }
            if usingPreviewShell,
               let preview = CoachChatPreviewData.historyThreads.first(where: { $0.id == id }) {
                return preview
            }
        }
        if let today = todayThread { return today }
        return emptyTodayShell
    }

    private var isViewingToday: Bool {
        displayThread.dayOffset == 0
    }

    var body: some View {
        Group {
            if threadsLoading {
                loadingView
            } else {
                continuousLandingView
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
        .toast($toast)
        .background(ChatVisibilityProbe { visible in
            Task { @MainActor in
                syncManager.isChatVisible = visible
            }
        })
        .sheet(item: $openedActivity) { entry in
            NavigationStack {
                ActivityDetailView(entry: entry)
                    .environmentObject(authManager)
            }
        }
        .task(id: chatFetchToken) {
            guard authManager.isAuthenticated, authManager.isSessionReady else { return }
            guard authManager.selectedRepo != nil else { return }
            let client = CoachChatAPIClient(authManager: authManager)
            apiClient = client
            syncManager.attachCoachChatClient(client)
            await loadThreads()
            await loadHeaderContext()
            applyActivitySyncTurn(syncManager.activitySyncTurn)
        }
        .onChange(of: syncManager.activitySyncTurn) { _, turn in
            applyActivitySyncTurn(turn)
        }
        .sheet(isPresented: $showHistorySheet) {
            CoachChatHistorySheet(
                threads: historyThreads,
                todayThreadId: todayThread?.id,
                headerContext: headerContext,
                onSelect: { thread in
                    if thread.messages.isEmpty, thread.dayOffset != 0 {
                        selectTodayThread()
                    } else {
                        activeThreadId = thread.id
                    }
                },
                onNew: {
                    draft = ""
                    guard let apiClient else { return }
                    Task { await greetNow(apiClient: apiClient) }
                }
            )
        }
        .onChange(of: errorMessage) { _, message in
            showErrorDialog = message != nil
        }
        .overlay {
            if showErrorDialog, let message = errorMessage {
                WarmDialog(
                    title: "Coach chat",
                    message: message,
                    primaryTitle: "OK",
                    primaryAction: dismissErrorDialog,
                    onBackdropTap: dismissErrorDialog
                )
                .transition(.opacity)
            }
        }
        .animation(.spring(duration: 0.25, bounce: 0), value: showErrorDialog)
        .hidesMainTabBar(keyboardVisible)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardVisible = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardVisible = false
        }
        .onChange(of: requestedProactiveRoute) { _, route in
            guard route != nil, !threadsLoading else { return }
            if !openRequestedProactiveRoute(), let apiClient {
                if let today = todayThread {
                    activeThreadId = today.id
                } else {
                    Task { await greetNow(apiClient: apiClient) }
                }
            }
        }
    }

    private var composerChromeHidden: Bool {
        composerFocused || keyboardVisible
    }

    private var composerPlaceholder: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if !isViewingToday { return "Reply to Coach…" }
        switch hour {
        case 5..<10:  return "How are you feeling today?"
        case 10..<14: return "What's on your mind?"
        case 14..<18: return "How did training go?"
        case 18..<22: return "How did it feel?"
        default:      return "Message Coach…"
        }
    }

    // MARK: - Continuous landing

    private var continuousLandingView: some View {
        VStack(spacing: 0) {
            CoachChatHeaderBar(
                context: headerContext.forDisplayThread(displayThread),
                showsBack: !isViewingToday,
                onBack: isViewingToday ? nil : { selectTodayThread() },
                onHistory: { showHistorySheet = true }
            )

            ScrollViewReader { proxy in
                GeometryReader { geo in
                    ScrollView {
                        chatMessageStack
                            .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .bottom)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .background(WarmInstrument.chatSurface)
                    .onAppear {
                        scrollToBottom(proxy: proxy, animated: false)
                    }
                    .onChange(of: displayThread.messages.count) { oldCount, newCount in
                        guard newCount > oldCount else { return }
                        scrollToBottom(proxy: proxy)
                    }
                    .onChange(of: sending) { _, isSending in
                        if isSending {
                            scrollToBottom(proxy: proxy, anchor: "thinking")
                        }
                    }
                    .onChange(of: syncManager.activitySyncTurn?.phase) { _, phase in
                        if phase == .requestingCoach {
                            scrollToBottom(proxy: proxy, anchor: "thinking")
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composerDock
                .animation(.easeOut(duration: 0.2), value: composerChromeHidden)
        }
    }

    private var chatMessageStack: some View {
        VStack(alignment: .leading, spacing: 16) {
            if displayThread.messages.isEmpty, !isViewingToday {
                CoachChatEmptyThreadPrompt(
                    dayLabel: headerContext.dayLabel(offset: displayThread.dayOffset),
                    threadTitle: displayThread.title,
                    onBackToToday: { selectTodayThread() }
                )
            } else if displayThread.messages.isEmpty, isViewingToday, usingPreviewShell, !chatWelcomeShown {
                CoachChatWelcomeIntro()
            } else {
                ForEach(displayThread.messages) { message in
                    messageRow(message)
                        .id(message.id)
                }
            }

            // Gate on today's thread having no messages yet, in addition to yesterdayThread's own
            // condition - once the athlete sends their first message of the day, the pick-up
            // banner should disappear (issue #244), not just fade with the rest of the composer chrome.
            if isViewingToday, displayThread.messages.isEmpty, let yesterday = yesterdayThread {
                CoachChatPickUpRow(
                    dayLabel: headerContext.dayLabel(offset: yesterday.dayOffset),
                    title: "Pick up \"\(yesterday.title)\""
                ) {
                    activeThreadId = yesterday.id
                }
                .opacity(composerChromeHidden ? 0 : 1)
                .frame(height: composerChromeHidden ? 0 : nil)
                .clipped()
                .allowsHitTesting(!composerChromeHidden)
            }

            if let turn = syncManager.activitySyncTurn, turn.needsRetry {
                CoachChatSyncRetryRow {
                    Task { await syncManager.retryActivitySyncTurn() }
                }
            }

            if sending || syncManager.activitySyncTurn?.isThinking == true {
                HStack {
                    CoachChatThinkingBubble()
                    Spacer(minLength: 40)
                }
                .id("thinking")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    private var composerDock: some View {
        VStack(spacing: 8) {
            CoachChatComposer(
                draft: $draft,
                isFocused: $composerFocused,
                placeholder: coachIsReplying ? "Coach is replying…" : composerPlaceholder,
                isSending: coachIsReplying,
                onSend: { Task { await send(from: resolvedSendThreadId()) } }
            )
        }
        .padding(.top, 8)
        .padding(.bottom, keyboardVisible ? 8 : WarmMainDockLayout.dockHeight + 4)
        .background(WarmInstrument.chatSurface)
    }

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(WarmInstrument.inkMuted)
            Text("Loading Coach…")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(WarmInstrument.inkFaint)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Messages

    /// The server stores a divider's label frozen at creation time ("TODAY · 2:00 AM"), which
    /// reads as wrong forever once the thread is no longer from today. Only the FIRST divider
    /// gets the dynamic replacement - a thread only ever has one in practice, but guarding by id
    /// rather than "every divider" avoids surprises if that ever changes.
    private var firstDividerId: String? {
        displayThread.messages.first(where: { $0.role == .divider })?.id
    }

    @ViewBuilder
    private func messageRow(_ message: ChatMessage) -> some View {
        switch message.role {
        case .divider:
            CoachChatDayDivider(label: message.id == firstDividerId ? displayThread.dividerLabel : (message.label ?? ""))
                .frame(maxWidth: .infinity)

        case .user:
            HStack {
                Spacer(minLength: 40)
                CoachChatUserBubble(text: message.text ?? "")
            }

        case .coach:
            VStack(alignment: .leading, spacing: 10) {
                if let list = message.syncedActivityList {
                    CoachChatSyncedActivityList(activities: list.activities) { row in
                        if let entry = cacheEntry(for: row) {
                            openedActivity = entry
                        }
                    }
                }
                if !(message.paragraphs ?? []).isEmpty {
                    HStack {
                        CoachChatCoachBubble(
                            paragraphs: message.paragraphs ?? [],
                            chips: chips(for: message),
                            showSignature: showSignature(for: message)
                        )
                        Spacer(minLength: 40)
                    }
                }
            }
        }
    }

    /// Wireup: replace preview map with API-provided chip payloads on coach messages. No backend
    /// data exists for this yet (Gemini's response schema has no chips field) - deferred, see
    /// issue tracking coach chat's remaining gaps.
    private func chips(for message: ChatMessage) -> [CoachChatInlineChip] {
        CoachChatPreviewData.chipsByMessageId[message.id] ?? []
    }

    /// Sign only the most recent coach reply in the displayed thread, not every bubble -
    /// matches web's CoachChatWidgets.tsx fix. Previously matched against a hardcoded preview
    /// message id that no real message ever has, so the signature never appeared for any real
    /// athlete.
    private func showSignature(for message: ChatMessage) -> Bool {
        message.id == displayThread.messages.last(where: { $0.role == .coach })?.id
    }

    private func dismissErrorDialog() {
        showErrorDialog = false
        errorMessage = nil
    }

    private func selectTodayThread() {
        activeThreadId = todayThread?.id
    }

    private func resolvedSendThreadId() -> String? {
        let id = displayThread.id
        if threads.contains(where: { $0.id == id }) { return id }
        if id == CoachChatPreviewData.previewTodayThreadId { return nil }
        return id.hasPrefix("local-") ? id : nil
    }

    private func scrollToBottom(proxy: ScrollViewProxy, anchor: String? = nil, animated: Bool = true) {
        let target = anchor ?? displayThread.messages.last?.id
        guard let target else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(target, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(target, anchor: .bottom)
        }
    }

    private var coachIsReplying: Bool {
        sending || syncManager.activitySyncTurn?.isThinking == true
    }

    private static let provisionalSyncThreadId = "local-activity-sync"

    private func applyActivitySyncTurn(_ turn: ActivitySyncTurn?) {
        guard let turn else {
            threads.removeAll { $0.id == Self.provisionalSyncThreadId }
            return
        }
        switch turn.phase {
        case .complete:
            applyCompletedSyncTurn(turn)
        case .waitingForSnapshots, .requestingCoach, .retryWait, .retryPost:
            upsertProvisionalSyncThread(activities: turn.activities)
        }
    }

    private func applyCompletedSyncTurn(_ turn: ActivitySyncTurn) {
        guard !turn.completedThreads.isEmpty else { return }
        threads.removeAll { $0.id == Self.provisionalSyncThreadId }
        threads = turn.completedThreads
        if let id = turn.completedThreadId {
            activeThreadId = id
        }
        if let repo = authManager.repoFullName, let id = turn.completedThreadId,
           let thread = threads.first(where: { $0.id == id }) {
            CoachChatLocalCache.save(messages: thread.messages, repoFullName: repo, threadId: id)
        }
        if !syncManager.isChatVisible {
            chatHasUnread = true
        }
    }

    private func upsertProvisionalSyncThread(activities: [SyncedActivityDraft]) {
        let rows = activities.map(\.asRow)
        let attachment = SyncedActivityListAttachment.provisional(activities: rows)
        let now = Date().timeIntervalSince1970 * 1000
        let coach = ChatMessage.coach(
            id: "c-sync-\(Int(now))",
            paragraphs: [],
            attachments: [.syncedActivityList(attachment)]
        )
        if let idx = threads.firstIndex(where: { $0.id == Self.provisionalSyncThreadId }) {
            if let existing = threads[idx].messages.last(where: { $0.role == .coach }) {
                var updated = existing
                updated.attachments = [.syncedActivityList(attachment)]
                threads[idx].messages = threads[idx].messages.map { $0.id == existing.id ? updated : $0 }
            } else {
                threads[idx].messages.append(coach)
            }
        } else {
            let created = ChatThread(
                id: Self.provisionalSyncThreadId,
                dayOffset: 0,
                createdAt: now,
                title: rows.count == 1 ? (rows.first?.title.isEmpty == false ? rows[0].title : "Session synced") : "\(rows.count) sessions synced",
                preview: rows.map(\.title).joined(separator: ", "),
                ageLabel: "NOW",
                status: .active,
                messages: [
                    ChatMessage.divider(id: "d-sync-\(Int(now))", label: "TODAY"),
                    coach,
                ]
            )
            threads.insert(created, at: 0)
        }
        activeThreadId = Self.provisionalSyncThreadId
    }

    private func cacheEntry(for row: SyncedActivityRow) -> SyncCacheEntry? {
        let cache = SyncCache.load()
        if let hit = cache.first(where: { $0.activity?.activityId == row.id }) {
            return hit
        }
        if let hit = cache.first(where: { $0.fileName.contains(row.id) }) {
            return hit
        }
        if let draft = syncManager.lastSyncedActivities.first(where: { $0.activityId == row.id }) {
            return cache.first(where: { $0.fileName == draft.fileName })
        }
        return nil
    }

    private var chatFetchToken: String {
        [
            authManager.isAuthenticated ? "authed" : "anon",
            authManager.isSessionReady ? "ready" : "boot",
            authManager.user?.login ?? "",
            authManager.selectedRepo ?? "",
        ].joined(separator: "|")
    }

    // MARK: - Networking

    private func clearThreadState() {
        threads = []
        activeThreadId = nil
        threadsLoading = true
    }

    private func loadThreads() async {
        guard let apiClient else { return }
        threadsLoading = true
        profileComplete = false
        defer { threadsLoading = false }

        do {
            profileComplete = (try? await apiClient.profileStatus()) ?? false
            // B3: completion is decided ONLY by CoachSetupBootstrap.shouldOpenChatFirst()'s live
            // profileComplete check (MainTabView.swift's .task) - never inferred from thread
            // existence here. That used to be the premature-completion bug, and A4's coach-
            // speaks-first design made it worse: a greeting thread now exists the instant this
            // view loads, before the athlete has said anything at all.
            let fetched = try await apiClient.fetchThreads()
            let requestedSeed = requestedProactiveRoute.flatMap { route in
                route.repoFullName == authManager.repoFullName
                    ? route.conversationSeedId
                    : nil
            }
            threads = authManager.repoFullName.map {
                CoachChatLocalCache.restoring(
                    fetched,
                    repoFullName: $0,
                    preservingThreadId: requestedSeed
                )
            } ?? fetched
            if openRequestedProactiveRoute() {
                return
            } else if let today = todayThread {
                activeThreadId = today.id
            } else {
                await greetNow(apiClient: apiClient)
            }
        } catch let error as GitHubAPIError {
            if case .sessionNotReady = error { return }
            if case .notAuthenticated = error {
                authManager.sessionExpired = true
                clearThreadState()
                return
            }
            errorMessage = UserFacingError.friendlyMessage(for: error)
        } catch {
            errorMessage = "Couldn't load conversations"
        }
    }

    /// Opens one exact local proactive seed. A repeated Home/notification tap selects the
    /// cached thread instead of appending the opener again.
    @discardableResult
    private func openRequestedProactiveRoute() -> Bool {
        guard let route = requestedProactiveRoute else { return false }
        guard route.repoFullName == authManager.repoFullName else {
            requestedProactiveRoute = nil
            CoachMessageRoute.clear()
            return false
        }

        if threads.contains(where: { $0.id == route.conversationSeedId }) {
            activeThreadId = route.conversationSeedId
        } else {
            let thread = CoachChatLocalCache.proactiveThread(for: route)
            threads.insert(thread, at: 0)
            activeThreadId = thread.id
            cacheThreadLocally(thread)
        }
        requestedProactiveRoute = nil
        CoachMessageRoute.clear()
        return true
    }

    /// A4: coach speaks first. coach-chat.ts's handleGreet() no longer commits anything
    /// server-side (every open, not just the first, gets a fresh live Gemini greeting instead
    /// of a stale reused one - see the ADR-linked comment in coach-chat.ts) - `result.threads`
    /// is just the existing committed list unchanged, and `result.threadId` is a fresh, never
    /// persisted id. Materialize the greeting as a local-only thread here instead (same
    /// "local-<timestamp>" convention materializeThreadIfNeeded already uses below for a
    /// brand-new athlete-initiated thread) and cache it immediately, so nothing is lost if the
    /// athlete backgrounds the app before replying.
    private func greetNow(apiClient: CoachChatAPIClient) async {
        do {
            // B4: only relevant for a brand-new athlete's very first greet (harmless to pass
            // otherwise - the server ignores it whenever the reuse-existing-thread path applies,
            // or once state.md's Athlete Profile is already filled in and there's nothing left
            // to reflect back).
            let result = try await apiClient.greet(onboardingHints: OnboardingHints.load())
            if let complete = result.profileComplete {
                profileComplete = complete
            }
            // Supersede any previous unreplied local greeting instead of accumulating orphans -
            // repeated "New conversation" taps (or a retry after a failed first greet) would
            // otherwise each leave their own local-cache entry that's never cleared (found via
            // code review: nothing calls CoachChatLocalCache.clear for an unreplied greeting,
            // only a real reply's commit does). Clearing here means at most one unreplied local
            // greeting's cache entry can ever exist at a time.
            if let repo = authManager.repoFullName {
                threads.removeAll { existing in
                    guard existing.id.hasPrefix("local-"),
                          !existing.id.hasPrefix("local-proactive-"),
                          existing.dayOffset == 0 else { return false }
                    let real = existing.messages.filter { $0.role != .divider }
                    guard real.count == 1, real[0].role == .coach else { return false }
                    CoachChatLocalCache.clear(repoFullName: repo, threadId: existing.id)
                    return true
                }
            }
            let now = Date().timeIntervalSince1970 * 1000
            let localId = "local-\(Int(now))"
            let greeted = ChatThread(
                id: localId,
                dayOffset: 0,
                createdAt: now,
                title: "New conversation",
                preview: String(result.reply.prefix(80)),
                ageLabel: "NOW",
                status: .active,
                messages: [
                    ChatMessage.divider(id: "d-\(Int(now))", label: "TODAY"),
                    ChatMessage.coach(id: "c-\(Int(now))", paragraphs: [result.reply]),
                ]
            )
            threads = [greeted] + result.threads
            activeThreadId = localId
            cacheThreadLocally(greeted)
        } catch let error as GitHubAPIError {
            if case .sessionNotReady = error { return }
            if case .notAuthenticated = error {
                authManager.sessionExpired = true
                clearThreadState()
                return
            }
            errorMessage = UserFacingError.friendlyMessage(for: error)
        } catch {
            errorMessage = "Coach couldn't start a conversation"
        }
    }

    /// Live thread messages only — never include preview shell content or local welcome messages in API context.
    private func priorMessagesForSend(targetId: String?) -> [ChatMessage] {
        guard let targetId,
              let thread = threads.first(where: { $0.id == targetId }) else {
            return []
        }
        return thread.messages.filter { $0.id != "welcome-coach" }
    }

    /// Defensive fallback only (A4: coach speaks first) - by the time the athlete can type,
    /// greetNow() should already have created today's real, server-committed thread with
    /// Coach's opening line. This only fires if that failed and the athlete typed anyway; it
    /// creates a bare local thread with no synthetic greeting text (no longer fabricates one
    /// client-side - that's Gemini's job now, not a hardcoded string).
    @discardableResult
    private func materializeThreadIfNeeded(for targetId: String?) -> String {
        if let targetId, threads.contains(where: { $0.id == targetId }) {
            return targetId
        }

        let now = Date().timeIntervalSince1970 * 1000
        let id = targetId?.hasPrefix("local-") == true ? targetId! : "local-\(Int(now))"
        if threads.contains(where: { $0.id == id }) {
            return id
        }

        let divider = ChatMessage.divider(
            id: "d-\(Int(now))",
            label: "TODAY · \(headerContext.dayLabel(offset: 0))"
        )
        let created = ChatThread(
            id: id,
            dayOffset: 0,
            createdAt: now,
            title: "Today's thread",
            preview: "",
            ageLabel: "NOW",
            status: .active,
            messages: [divider]
        )
        threads.insert(created, at: 0)
        activeThreadId = id
        return id
    }

    private func appendUserMessage(_ message: ChatMessage, to threadId: String) {
        guard let idx = threads.firstIndex(where: { $0.id == threadId }) else { return }
        threads[idx].messages.append(message)
        cacheThreadLocally(threads[idx])
    }

    /// Local-cache resumability (issue #244): the server only commits `chat_history.json` when
    /// a thread closes, so every append in between is at risk of a force-quit. Mirror it to
    /// UserDefaults immediately so `loadThreads()` can restore it on relaunch.
    private func cacheThreadLocally(_ thread: ChatThread) {
        guard let repoFullName = authManager.repoFullName else { return }
        CoachChatLocalCache.save(messages: thread.messages, repoFullName: repoFullName, threadId: thread.id)
    }

    private func removeUserMessage(_ message: ChatMessage, from threadId: String) {
        guard let idx = threads.firstIndex(where: { $0.id == threadId }) else { return }
        threads[idx].messages.removeAll { $0.id == message.id }
    }

    private func send(from targetId: String?) async {
        guard let apiClient else { return }
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sending, !trimmed.isEmpty else { return }

        if !chatWelcomeShown { chatWelcomeShown = true }

        let priorMessages = priorMessagesForSend(targetId: targetId)
        // Track whether this send created the local thread so a failed send can roll it back.
        let threadExistedBefore = targetId != nil && threads.contains(where: { $0.id == targetId })
        let liveThreadId = materializeThreadIfNeeded(for: targetId)

        draft = ""

        let now = Date().timeIntervalSince1970 * 1000
        let userMsg = ChatMessage.user(id: "u-\(now)", text: trimmed)
        appendUserMessage(userMsg, to: liveThreadId)

        sending = true
        defer { sending = false }

        do {
            let result = try await apiClient.sendMessage(
                threadId: targetId,
                priorMessages: priorMessages,
                message: trimmed
            )

            if let complete = result.profileComplete {
                profileComplete = complete
                if complete, let repo = authManager.repoFullName {
                    CoachSetupState.markComplete(repoFullName: repo)
                    OnboardingHints.clear()
                }
            }

            // C1: every turn commits fully now - the server's `threads` is always fresh,
            // committed truth, so trust it outright instead of appending the reply ourselves.
            threads = result.threads
            activeThreadId = result.threadId
            // The commit just landed server-side, so the server copy is now the truth - drop
            // the local cache for this thread (issue #244 resumability).
            if let repo = authManager.repoFullName {
                CoachChatLocalCache.clear(repoFullName: repo, threadId: liveThreadId)
            }

            // A5: the server detected this thread's repo state changed since we last saw it
            // (most likely another device sent a message first) and already re-read fresh
            // context before replying - explain why Coach's answer might reference something new.
            if result.stale == true {
                toast = Toast(kind: .info, message: "Coach caught up on changes from your other device")
            }

            // D1 (#736): a firm requirement, not left to Coach's own reply happening to mention
            // it - an explicit, honest indicator whenever something was dropped, and a
            // client-side Sentry capture so the pattern is visible from both ends, not just the
            // backend's. Mirrors web's toast.info() + Sentry.captureMessage() in CoachChat.tsx.
            // Nothing else needed here - `threads` (trusted above) already carries the reply.
            if let dropped = result.droppedActions, !dropped.isEmpty {
                toast = Toast(kind: .info, message: "Coach couldn't quite save one of your updates - it wasn't lost, just skipped")
                SentrySDK.capture(message: "coach-chat: droppedActions in turn response") { scope in
                    scope.setLevel(.warning)
                    scope.setTag(value: String(dropped.count), key: "dropped_count")
                    scope.setContext(value: ["dropped_actions": dropped.map { ["field": $0.field, "reason": $0.reason] }], key: "coach_turn")
                }
            }
        } catch let error as CoachChatSaveFailedError {
            // D1 (#736): a save failure that still carries Coach's reply is not "Coach didn't
            // reply" - Gemini did its job, only the write failed. Keep the optimistic user
            // message and show the reply text (rather than rolling everything back like every
            // other failure below), with a clear, distinct "couldn't save that" indicator -
            // parity with web's CoachChatSaveFailedError handling in CoachChat.tsx.
            let coachMsg = ChatMessage.coach(id: "c-\(now)", paragraphs: [error.reply])
            if let idx = threads.firstIndex(where: { $0.id == liveThreadId }) {
                threads[idx].messages.append(coachMsg)
                activeThreadId = liveThreadId
                cacheThreadLocally(threads[idx])
            }
            errorMessage = UserFacingError.friendlyMessage(for: error)
        } catch let error as GitHubAPIError {
            rollbackFailedSend(userMsg, threadId: liveThreadId, threadExistedBefore: threadExistedBefore)
            if case .notAuthenticated = error {
                authManager.sessionExpired = true
                clearThreadState()
            } else {
                errorMessage = UserFacingError.friendlyMessage(for: error)
            }
            draft = trimmed
        } catch {
            rollbackFailedSend(userMsg, threadId: liveThreadId, threadExistedBefore: threadExistedBefore)
            errorMessage = "Coach didn't reply — try again"
            draft = trimmed
        }
    }

    private func rollbackFailedSend(_ message: ChatMessage, threadId: String, threadExistedBefore: Bool) {
        if threadExistedBefore {
            removeUserMessage(message, from: threadId)
            if let idx = threads.firstIndex(where: { $0.id == threadId }) {
                cacheThreadLocally(threads[idx])
            }
        } else {
            threads.removeAll { $0.id == threadId }
            if activeThreadId == threadId { activeThreadId = nil }
            if let repo = authManager.repoFullName {
                CoachChatLocalCache.clear(repoFullName: repo, threadId: threadId)
            }
        }
    }
}

/// Reports whether Chat is the visible tab. MainTabView keeps every tab mounted and hides
/// the others with opacity — onAppear is not enough.
private struct ChatVisibilityProbe: UIViewRepresentable {
    var onChange: (Bool) -> Void

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.onChange = onChange
        return view
    }

    func updateUIView(_ uiView: ProbeView, context: Context) {
        uiView.onChange = onChange
    }

    final class ProbeView: UIView {
        var onChange: ((Bool) -> Void)?

        override func didMoveToWindow() { report() }
        override func layoutSubviews() {
            super.layoutSubviews()
            report()
        }

        private func report() {
            var visible = window != nil
            var view: UIView? = self
            while let current = view {
                if current.isHidden || current.alpha < 0.01 {
                    visible = false
                    break
                }
                view = current.superview
            }
            onChange?(visible)
        }
    }
}

// MARK: - Header helpers

extension CoachChatHeaderContext {
    /// `D-143` with offset 1 → `D-142` (wireup: derive from challenge day index).
    func dayLabel(offset: Int) -> String {
        let base = Int(dayLabel.replacingOccurrences(of: "D-", with: "")) ?? 0
        return "D-\(max(0, base - offset))"
    }

    /// Today → day only (`D-143`). Older threads → day + title (`D-142 · Bar felt cold`).
    func forDisplayThread(_ thread: ChatThread) -> CoachChatHeaderContext {
        if thread.dayOffset == 0 {
            return CoachChatHeaderContext(dayLabel: dayLabel, secondaryLabel: nil, statusSuffix: nil)
        }
        return CoachChatHeaderContext(
            dayLabel: dayLabel(offset: thread.dayOffset),
            secondaryLabel: thread.title,
            statusSuffix: nil
        )
    }
}
