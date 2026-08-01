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
    @EnvironmentObject private var widgetStore: WidgetSnapshotStore

    @State private var apiClient: CoachChatAPIClient?
    @State private var threads: [ChatThread] = []
    @State private var activeThreadId: String?
    @State private var draft = ""
    @State private var threadsLoading = true
    @State private var sending = false
    @State private var errorMessage: String?
    @State private var showErrorDialog = false
    @State private var showHistorySheet = false
    @FocusState private var composerFocused: Bool
    @State private var keyboardVisible = false
    @State private var postWorkoutChips: [String]? = nil
    @AppStorage("chatHasUnread") private var chatHasUnread = false
    @AppStorage("pendingWorkoutType") private var pendingWorkoutType = ""
    @AppStorage("chatWelcomeShown") private var chatWelcomeShown = false
    @AppStorage("preferredName") private var preferredName = ""

    /// Real challenge day, fetched once per session from challenge_v2.json (see loadHeaderContext()
    /// below) - nil until that fetch resolves, at which point headerContext below reflects it.
    @State private var liveDayNumber: Int?

    /// Day label comes from a live fetch of challenge_v2.json's start_date (same math as web's
    /// challengeDayNumber() in coachChatModel.ts); week label reuses the same engine.weekLabel
    /// the Home tab already shows, via widgetStore - no second fetch needed for that half. Falls
    /// back to the preview constant only until the real day number resolves.
    private var headerContext: CoachChatHeaderContext {
        CoachChatHeaderContext(
            dayLabel: liveDayNumber.map { "D-\($0)" } ?? CoachChatHeaderContext.preview.dayLabel,
            weekLabel: widgetStore.snapshots?.home.engine.weekLabel ?? CoachChatHeaderContext.preview.weekLabel,
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
        guard let startDate = try? await client.readChallengeStartDate() else { return }
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
            archivedAt: nil,
            deletedAt: nil,
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
        .task(id: chatFetchToken) {
            guard authManager.isAuthenticated, authManager.isSessionReady else { return }
            guard authManager.selectedRepo != nil else { return }
            apiClient = CoachChatAPIClient(authManager: authManager)
            await loadThreads()
            await loadHeaderContext()
            if !pendingWorkoutType.isEmpty {
                postWorkoutChips = Self.chips(forWorkoutType: pendingWorkoutType)
                pendingWorkoutType = ""
            }
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
                    activeThreadId = nil
                    draft = ""
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
        .onChange(of: pendingWorkoutType) { _, type in
            guard !type.isEmpty else { return }
            postWorkoutChips = Self.chips(forWorkoutType: type)
            pendingWorkoutType = ""
        }
    }

    private var composerChromeHidden: Bool {
        composerFocused || keyboardVisible
    }

    private var composerPlaceholder: String {
        // Waiting for name during welcome intro
        if usingPreviewShell && !chatWelcomeShown { return "Your name…" }
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

            if isViewingToday, let yesterday = yesterdayThread {
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

            if sending {
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
            if isViewingToday && (chatWelcomeShown || !usingPreviewShell) {
                CoachChatStarterChips(
                    prompts: postWorkoutChips ?? CoachChatPreviewData.starterPrompts,
                    isDisabled: sending
                ) { prompt in
                    postWorkoutChips = nil
                    draft = prompt
                    Task { await send(from: resolvedSendThreadId()) }
                }
                .opacity(composerChromeHidden ? 0 : 1)
                .frame(height: composerChromeHidden ? 0 : nil)
                .clipped()
                .allowsHitTesting(!composerChromeHidden)
            }

            CoachChatComposer(
                draft: $draft,
                isFocused: $composerFocused,
                placeholder: sending ? "Coach is replying…" : composerPlaceholder,
                isSending: sending
            ) {
                Task { await send(from: resolvedSendThreadId()) }
            }
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

    @ViewBuilder
    private func messageRow(_ message: ChatMessage) -> some View {
        switch message.role {
        case .divider:
            CoachChatDayDivider(label: message.label ?? "")
                .frame(maxWidth: .infinity)

        case .user:
            HStack {
                Spacer(minLength: 40)
                CoachChatUserBubble(text: message.text ?? "")
            }

        case .coach:
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

    private static func chips(forWorkoutType type: String) -> [String] {
        switch type {
        case "foundation":   return ["That felt good", "Legs were heavy", "How was my form?"]
        case "calisthenics": return ["That felt good", "Struggled with reps", "How was my form?"]
        case "recovery":     return ["Feeling restored", "Still feel tired", "Good call today"]
        case "realign":      return ["That helped", "Still feeling off", "How was my form?"]
        default:             return ["That felt good", "Legs were heavy", "How was my form?"]
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

    private func writeProfile(name: String) async {
        let client = GitHubAPIClient(authManager: authManager)
        let content = "# Athlete Profile\n\nname: \(name)\n"
        guard let data = content.data(using: .utf8) else { return }
        try? await client.commitFiles(
            [(path: "user/profile.md", data: data)],
            message: "profile: set preferred name"
        )
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
        defer { threadsLoading = false }

        do {
            threads = try await apiClient.fetchThreads()
            if !threads.filter({ $0.status != .deleted }).isEmpty,
               let repo = authManager.repoFullName {
                CoachSetupState.markComplete(repoFullName: repo)
            }
            // Wireup: prefer API today's thread; preview shell when empty.
            if let today = todayThread {
                activeThreadId = today.id
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

    /// Live thread messages only — never include preview shell content in API context.
    private func priorMessagesForSend(targetId: String?) -> [ChatMessage] {
        guard let targetId,
              let thread = threads.first(where: { $0.id == targetId }) else {
            return []
        }
        return thread.messages
    }

    /// Ensures a mutable live thread exists before optimistic UI update. Never inserts preview seed data.
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
            title: "Today's thread",
            preview: "",
            ageLabel: "NOW",
            status: .active,
            archivedAt: nil,
            deletedAt: nil,
            messages: [divider]
        )
        threads.insert(created, at: 0)
        activeThreadId = id
        return id
    }

    private func appendUserMessage(_ message: ChatMessage, to threadId: String) {
        guard let idx = threads.firstIndex(where: { $0.id == threadId }) else { return }
        threads[idx].messages.append(message)
    }

    private func removeUserMessage(_ message: ChatMessage, from threadId: String) {
        guard let idx = threads.firstIndex(where: { $0.id == threadId }) else { return }
        threads[idx].messages.removeAll { $0.id == message.id }
    }

    private func send(from targetId: String?) async {
        guard let apiClient else { return }
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !sending else { return }

        // First message from a new user — treat it as their name.
        if preferredName.isEmpty {
            let name = String(trimmed.prefix(30))
            preferredName = name
            Task { await writeProfile(name: name) }
        }
        if !chatWelcomeShown { chatWelcomeShown = true }

        let priorMessages = priorMessagesForSend(targetId: targetId)
        draft = ""

        let now = Date().timeIntervalSince1970 * 1000
        let userMsg = ChatMessage.user(id: "u-\(now)", text: trimmed)
        let liveThreadId = materializeThreadIfNeeded(for: targetId)
        appendUserMessage(userMsg, to: liveThreadId)

        sending = true
        defer { sending = false }

        do {
            let result = try await apiClient.sendMessage(threadId: targetId, priorMessages: priorMessages, message: trimmed)

            if result.closed, let newThreads = result.threads {
                threads = newThreads
                activeThreadId = result.threadId
                if let repo = authManager.repoFullName {
                    CoachSetupState.markComplete(repoFullName: repo)
                }
                return
            }

            let coachMsg = ChatMessage.coach(id: "c-\(now)", paragraphs: [result.reply])
            if let idx = threads.firstIndex(where: { $0.id == liveThreadId }) {
                threads[idx].messages.append(coachMsg)
                threads[idx].preview = String(result.reply.prefix(80))
                threads[idx].ageLabel = "NOW"
                threads[idx].status = .active
                activeThreadId = liveThreadId
            }
        } catch let error as GitHubAPIError {
            removeUserMessage(userMsg, from: liveThreadId)
            if case .notAuthenticated = error {
                authManager.sessionExpired = true
                clearThreadState()
            } else {
                errorMessage = UserFacingError.friendlyMessage(for: error)
            }
            draft = trimmed
        } catch {
            removeUserMessage(userMsg, from: liveThreadId)
            errorMessage = "Coach didn't reply — try again"
            draft = trimmed
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

    /// Today → block position (`D-143 · WK 4/4`). Older threads → day + title (`D-142 · Bar felt cold`).
    func forDisplayThread(_ thread: ChatThread) -> CoachChatHeaderContext {
        if thread.dayOffset == 0 {
            return CoachChatHeaderContext(dayLabel: dayLabel, weekLabel: weekLabel, statusSuffix: nil)
        }
        return CoachChatHeaderContext(
            dayLabel: dayLabel(offset: thread.dayOffset),
            weekLabel: thread.title,
            statusSuffix: nil
        )
    }
}
