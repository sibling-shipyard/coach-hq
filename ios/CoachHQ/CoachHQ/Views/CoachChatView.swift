import SwiftUI

/// Native Coach Chat - a client of the same /api/coach-chat endpoint the web app uses
/// (platform/docs/coach-chat-flow.md, ADR 0012). No Gemini or commit logic lives here; this
/// view only sends/receives and renders. Smallest useful surface for #126: thread list +
/// conversation pane + thinking indicator, matching the web app's information, not its full
/// Warm Instrument chrome pixel-for-pixel.
struct CoachChatView: View {
    @EnvironmentObject private var authManager: GitHubAuthManager

    @State private var apiClient: CoachChatAPIClient?
    @State private var threads: [ChatThread] = []
    @State private var activeThreadId: String?
    @State private var draft = ""
    @State private var threadsLoading = true
    @State private var sending = false
    @State private var errorMessage: String?
    @State private var needsSignIn = false

    private var activeThread: ChatThread? {
        threads.first { $0.id == activeThreadId }
    }

    var body: some View {
        NavigationStack {
            Group {
                if needsSignIn {
                    signInAgainView
                } else if let thread = activeThread {
                    conversationView(thread)
                } else {
                    threadListView
                }
            }
            .background(WarmInstrument.desk.ignoresSafeArea())
            .navigationTitle(needsSignIn ? "Coach Chat" : (activeThread?.title ?? "Coach Chat"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !needsSignIn && activeThread != nil {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button("Conversations") { activeThreadId = nil }
                    }
                }
                if !needsSignIn {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button {
                            activeThreadId = nil
                            draft = ""
                        } label: {
                            Image(systemName: "square.and.pencil")
                        }
                    }
                }
            }
        }
        .task(id: chatFetchToken) {
            guard authManager.isAuthenticated, authManager.isSessionReady else { return }
            guard authManager.selectedRepo != nil else { return }
            apiClient = CoachChatAPIClient(authManager: authManager)
            await loadThreads()
        }
        .alert("Coach chat", isPresented: .constant(errorMessage != nil), actions: {
            Button("OK") { errorMessage = nil }
        }, message: {
            Text(errorMessage ?? "")
        })
    }

    /// Re-triggers the thread load once GitHub profile + repo discovery finish - same fix
    /// WarmInstrumentHomeView.homeFetchToken applies for Home. Without this, a cold-launch
    /// race (token in Keychain ≠ repo discovered yet) leaves the thread list silently
    /// empty forever, since this tab never unmounts to re-run a plain `.task`.
    private var chatFetchToken: String {
        [
            authManager.isAuthenticated ? "authed" : "anon",
            authManager.isSessionReady ? "ready" : "boot",
            authManager.user?.login ?? "",
            authManager.selectedRepo ?? "",
        ].joined(separator: "|")
    }

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
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(WarmInstrument.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Thread list

    private var threadListView: some View {
        Group {
            if threadsLoading {
                ProgressView("Loading conversations…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if threads.isEmpty {
                emptyStateView
            } else {
                List {
                    ForEach(threads.filter { $0.status != .deleted }) { thread in
                        Button {
                            activeThreadId = thread.id
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(thread.title)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(WarmInstrument.ink)
                                Text(thread.preview)
                                    .font(.system(size: 13))
                                    .foregroundStyle(WarmInstrument.inkFaint)
                                    .lineLimit(2)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .listStyle(.plain)
                .refreshable { await loadThreads() }
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 32))
                .foregroundStyle(WarmInstrument.inkFaint)
            Text("Ask Coach anything")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(WarmInstrument.ink)
            composer(sendAction: { Task { await send(from: nil) } })
                .padding(.horizontal, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Conversation

    private func conversationView(_ thread: ChatThread) -> some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(thread.messages) { message in
                            messageRow(message)
                        }
                        if sending {
                            thinkingBubble.id("thinking")
                        }
                    }
                    .padding(16)
                }
                .onChange(of: sending) { _, isSending in
                    if isSending { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } }
                }
            }
            composer(sendAction: { Task { await send(from: thread.id) } })
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(WarmInstrument.paper)
        }
    }

    @ViewBuilder
    private func messageRow(_ message: ChatMessage) -> some View {
        switch message.role {
        case .divider:
            Text(message.label ?? "")
                .font(.system(size: 11, weight: .bold))
                .kerning(1.2)
                .foregroundStyle(WarmInstrument.inkFaint)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(message.text ?? "")
                    .font(.system(size: 15))
                    .foregroundColor(.white)
                    .padding(12)
                    .background(WarmInstrument.ink)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            }
        case .coach:
            HStack {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array((message.paragraphs ?? []).enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph)
                            .font(.system(size: 15))
                            .italic()
                            .foregroundStyle(WarmInstrument.ink)
                    }
                }
                .padding(12)
                .background(WarmInstrument.surfaceMuted)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
                Spacer(minLength: 40)
            }
        }
    }

    private var thinkingBubble: some View {
        HStack {
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { _ in
                    Circle().frame(width: 6, height: 6).foregroundStyle(WarmInstrument.inkFaint)
                }
            }
            .padding(12)
            .background(WarmInstrument.surfaceMuted)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            Spacer(minLength: 40)
        }
        .accessibilityLabel("Coach is thinking")
    }

    private func composer(sendAction: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            TextField(sending ? "Coach is replying…" : "Ask Coach anything…", text: $draft, axis: .vertical)
                .disabled(sending)
                .padding(10)
                .background(WarmInstrument.surfaceMuted)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            Button(action: sendAction) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending ? WarmInstrument.inkFaint : WarmInstrument.ink)
            }
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
        }
    }

    // MARK: - Networking

    /// Called wherever `needsSignIn` is set, so the previous account's threads can't flash on
    /// screen before the next sign-in's fetch completes (this view never re-mounts on sign-out).
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
        } catch let error as GitHubAPIError {
            if case .sessionNotReady = error { return }
            if case .notAuthenticated = error {
                needsSignIn = true
                clearThreadState()
                return
            }
            errorMessage = error.errorDescription ?? "Couldn't load conversations"
        } catch {
            errorMessage = "Couldn't load conversations"
        }
    }

    /// Mirrors CoachChat.tsx's appendUserMessage(): nothing is persisted server-side until a
    /// `closed: true` response reports a real commit (coach-chat-flow.md "ordinary turn" vs
    /// "close-session turn") - otherwise this appends the reply to local state itself.
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
                return
            }

            let coachMsg = ChatMessage.coach(id: "c-\(now)", paragraphs: [result.reply])
            if let targetId {
                if let idx = threads.firstIndex(where: { $0.id == targetId }) {
                    threads[idx].messages.append(contentsOf: [userMsg, coachMsg])
                    threads[idx].preview = String(result.reply.prefix(80))
                    threads[idx].ageLabel = "NOW"
                    threads[idx].status = .active
                }
            } else {
                let id = "local-\(now)"
                let divider = ChatMessage.divider(id: "d-\(now)", label: "TODAY")
                let created = ChatThread(
                    id: id,
                    dayOffset: 0,
                    title: String(trimmed.prefix(28)),
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
