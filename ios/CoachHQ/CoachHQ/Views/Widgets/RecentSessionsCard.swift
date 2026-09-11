import SwiftUI

/// In-app recent-sessions list. Moved here in W3b of docs/plans/ios-widget-modules.md —
/// renamed from `RecentSessionsWidget` to match the `…Card` convention (ADR 0037).
struct RecentSessionsCard: View {
    let sessions: [RecentSessionSnapshot]
    var compact: Bool = false
    var onOpenActivities: (() -> Void)? = nil
    let onOpen: (SyncCacheEntry) -> Void
    let onUnavailable: () -> Void

    @State private var cacheEntries: [SyncCacheEntry] = []

    private var visible: [RecentSessionSnapshot] { Array(sessions.prefix(3)) }

    var body: some View {
        WarmCard(padding: compact ? 18 : 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    MonoLabel(compact ? "RECENT" : "RECENT SESSIONS", size: compact ? 10 : 10)
                    Spacer()
                    if compact, let onOpenActivities {
                        Button {
                            Haptics.tap()
                            onOpenActivities()
                        } label: {
                            Text("All activity")
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundColor(WarmInstrument.ink)
                        }
                    }
                }
                .padding(.bottom, compact ? 4 : 4)

                if visible.isEmpty {
                    Text("No sessions logged yet — nothing invented here.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, session in
                            if compact {
                                SessionRow(session: session, compact: true)
                            } else {
                                SwipeToEditRow(onEdit: { handleEdit(session) }) {
                                    SessionRow(session: session).padding(.horizontal, 2)
                                }
                            }
                            if index < visible.count - 1 {
                                Divider().overlay(WarmInstrument.headerRule)
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            if cacheEntries.isEmpty {
                cacheEntries = SyncCache.load()
            }
        }
    }

    private func handleEdit(_ session: RecentSessionSnapshot) {
        let cache = cacheEntries.isEmpty ? SyncCache.load() : cacheEntries
        if let source = session.evidence?.source,
           let hit = cache.first(where: { $0.fileName == source }) {
            onOpen(hit)
            return
        }
        if let dateKey = session.evidence?.dateKey,
           let hit = cache.first(where: { $0.fileName.hasPrefix(dateKey) || $0.startDateLocal.hasPrefix(dateKey) }) {
            onOpen(hit)
            return
        }
        onUnavailable()
    }
}

// MARK: - Swipe → Edit row (sessions only; delete lives in session detail, not Home)

private struct SwipeToEditRow<Content: View>: View {
    let onEdit: () -> Void
    @ViewBuilder var content: Content

    @State private var offset: CGFloat = 0
    @GestureState private var dragTranslation: CGFloat = 0

    private let actionWidth: CGFloat = 72
    private let gap: CGFloat = 14

    var body: some View {
        ZStack(alignment: .trailing) {
            Button {
                Haptics.tap()
                withAnimation(.spring(duration: 0.3)) { offset = 0 }
                onEdit()
            } label: {
                Text("EDIT")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .tracking(0.8)
                    .foregroundColor(.white)
                    .frame(width: actionWidth, height: 44)
                    .background(WarmInstrument.editAction)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .opacity(offset < -20 ? 1 : 0)

            content
                .background(WarmInstrument.paper)
                .offset(x: offset + dragTranslation)
                .gesture(
                    DragGesture(minimumDistance: 12)
                        .updating($dragTranslation) { value, state, _ in
                            guard value.translation.width < 0 else { return }
                            state = max(value.translation.width, -(actionWidth + gap))
                        }
                        .onEnded { value in
                            let projected = offset + value.translation.width
                            withAnimation(.spring(duration: 0.3)) {
                                offset = projected < -(actionWidth / 2) ? -(actionWidth + gap) : 0
                            }
                        }
                )
        }
    }
}
