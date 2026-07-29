import SwiftUI

/// Native Coach Chat — Warm Instrument continuous landing (`Coach Chat Mobile.dc.html` Turn 1).
///
/// **Wireup checklist (Skanda):**
/// 1. `loadThreads()` — API returns seeded today thread on new-day open; drop preview fallback.
/// 2. `headerContext` — populate from `challenge_v2` / widget snapshots (`D-143 · WK 4/4 · …`).
/// 3. `chips(for:)` — map coach message metadata from API instead of `CoachChatPreviewData.chipsByMessageId`.
/// 4. `showSignature(for:)` — server flag on unprompted morning-read messages only.
/// 5. `historyThreads` — enforce 7-day window server-side; client already groups by `dayOffset`.
struct CoachChatView: View {
    @EnvironmentObject private var authManager: GitHubAuthManager

    @State private var apiClient: CoachChatAPIClient?
    @State private var threads: [ChatThread] = []
    @State private var activeThreadId: String?
    @State private var draft = ""
    @State private var threadsLoading = true
    @State private var sending = false
    @State private var errorMessage: String?
    @State private var showErrorDialog = false
    @State private var needsSignIn = false
    @State private var showHistorySheet = false

    /// Until wired: preview header from mock. Replace with snapshot/challenge_v2 read.
    @State private var headerContext = CoachChatHeaderContext.preview

    private var usingPreviewShell: Bool {
        !threadsLoading && threads.filter { $0.status != .deleted }.isEmpty
    }

    private var historyThreads: [ChatThread] {
        let live = threads.filter { $0.status != .deleted }
        return live.isEmpty ? CoachChatPreviewData.historyThreads : live
    }

    private var todayThread: ChatThread? {
        threads.first { $0.dayOffset == 0 && $0.status != .deleted }
    }

    private var yesterdayThread: ChatThread? {
        if let live = threads.first(where: { $0.dayOffset == 1 && $0.status != .deleted }) {
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
        return CoachChatPreviewData.seededTodayThread
    }

    private var isViewingToday: Bool {
        displayThread.dayOffset == 0
    }

    var body: some View {
        Group {
            if needsSignIn {
                signInAgainView
            } else if threadsLoading {
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
        }
        .sheet(isPresented: $showHistorySheet) {
            CoachChatHistorySheet(
                threads: historyThreads,
                todayThreadId: todayThread?.id ?? CoachChatPreviewData.previewTodayThreadId,
                onSelect: { thread in
                    activeThreadId = thread.id
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
    }

    // MARK: - Continuous landing

    private var continuousLandingView: some View {
        VStack(spacing: 0) {
            CoachChatHeaderBar(
                context: headerContext,
                showsBack: !isViewingToday,
                onBack: isViewingToday ? nil : { selectTodayThread() },
                onHistory: { showHistorySheet = true }
            )

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        ForEach(displayThread.messages) { message in
                            messageRow(message)
                                .id(message.id)
                        }

                        if isViewingToday, let yesterday = yesterdayThread {
                            CoachChatPickUpRow(
                                dayLabel: headerContext.dayLabel(offset: yesterday.dayOffset),
                                title: "Pick up \"\(yesterday.title)\""
                            ) {
                                activeThreadId = yesterday.id
                            }
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
                    .padding(.bottom, 6)
                }
                .background(WarmInstrument.chatSurface)
                .onAppear {
                    scrollToBottom(proxy: proxy)
                }
                .onChange(of: displayThread.messages.count) { _, _ in
                    scrollToBottom(proxy: proxy)
                }
                .onChange(of: sending) { _, isSending in
                    if isSending {
                        withAnimation { proxy.scrollTo("thinking", anchor: .bottom) }
                    }
                }
            }

            VStack(spacing: 8) {
                if isViewingToday {
                    CoachChatStarterChips(
                        prompts: CoachChatPreviewData.starterPrompts,
                        isDisabled: sending
                    ) { prompt in
                        draft = prompt
                        Task { await send(from: resolvedSendThreadId()) }
                    }
                }

                CoachChatComposer(
                    draft: $draft,
                    placeholder: sending ? "Coach is replying…" : "Message Coach…",
                    isSending: sending
                ) {
                    Task { await send(from: resolvedSendThreadId()) }
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 10)
            .background(WarmInstrument.chatSurface)
        }
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

    /// Wireup: replace preview map with API-provided chip payloads on coach messages.
    private func chips(for message: ChatMessage) -> [CoachChatInlineChip] {
        CoachChatPreviewData.chipsByMessageId[message.id] ?? []
    }

    /// Wireup: server should flag unprompted morning-read messages only.
    private func showSignature(for message: ChatMessage) -> Bool {
        CoachChatPreviewData.signatureMessageIds.contains(message.id)
    }

    // MARK: - Auth expired

    private var signInAgainView: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 32))
                .foregroundStyle(WarmInstrument.inkFaint)
            Text("Your GitHub access expired")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(WarmInstrument.ink)
            Text("This happens if you uninstalled the App or removed its access on GitHub's side.")
                .font(.system(size: 13))
                .foregroundStyle(WarmInstrument.inkFaint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                needsSignIn = false
                errorMessage = nil
                clearThreadState()
                authManager.signOut()
            } label: {
                Text("Sign in again")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(WarmInstrument.paper)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(WarmInstrument.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func dismissErrorDialog() {
        showErrorDialog = false
        errorMessage = nil
    }

    private func selectTodayThread() {
        activeThreadId = todayThread?.id ?? CoachChatPreviewData.previewTodayThreadId
    }

    private func resolvedSendThreadId() -> String? {
        let id = displayThread.id
        if threads.contains(where: { $0.id == id }) { return id }
        if id == CoachChatPreviewData.previewTodayThreadId { return nil }
        return id.hasPrefix("local-") ? id : nil
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        if let last = displayThread.messages.last?.id {
            proxy.scrollTo(last, anchor: .bottom)
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
            } else if activeThreadId == nil {
                activeThreadId = CoachChatPreviewData.previewTodayThreadId
            }
            // Wireup: headerContext = await CoachChatHeaderLoader.load(...)
        } catch let error as GitHubAPIError {
            if case .sessionNotReady = error { return }
            if case .notAuthenticated = error {
                needsSignIn = true
                clearThreadState()
                return
            }
            errorMessage = error.errorDescription ?? "Couldn't load conversations"
            activeThreadId = CoachChatPreviewData.previewTodayThreadId
        } catch {
            errorMessage = "Couldn't load conversations"
            activeThreadId = CoachChatPreviewData.previewTodayThreadId
        }
    }

    private func send(from targetId: String?) async {
        guard let apiClient else { return }
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !sending else { return }

        let priorMessages = targetId.flatMap { id in threads.first(where: { $0.id == id })?.messages } ?? []
        draft = ""
        sending = true
        defer { sending = false }

        let now = Date().timeIntervalSince1970 * 1000
        let userMsg = ChatMessage.user(id: "u-\(now)", text: trimmed)

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
            if let targetId, let idx = threads.firstIndex(where: { $0.id == targetId }) {
                threads[idx].messages.append(contentsOf: [userMsg, coachMsg])
                threads[idx].preview = String(result.reply.prefix(80))
                threads[idx].ageLabel = "NOW"
                threads[idx].status = .active
                activeThreadId = targetId
            } else {
                let id = "local-\(now)"
                let divider = ChatMessage.divider(id: "d-\(now)", label: headerContext.dayLabel(offset: 0))
                let created = ChatThread(
                    id: id,
                    dayOffset: 0,
                    title: "Today's thread",
                    preview: String(result.reply.prefix(80)),
                    ageLabel: "NOW",
                    status: .active,
                    messages: [divider, userMsg, coachMsg]
                )
                threads.insert(created, at: 0)
                activeThreadId = id
            }
        } catch let error as GitHubAPIError {
            if case .notAuthenticated = error {
                needsSignIn = true
                clearThreadState()
            } else {
                errorMessage = error.errorDescription ?? "Coach didn't reply — try again"
            }
            draft = trimmed
        } catch {
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
}
