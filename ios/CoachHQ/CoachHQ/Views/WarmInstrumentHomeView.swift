import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// Warm Instrument Home — a scrolling column of M widgets consuming
/// `gen/widget_snapshots.json` (same fetch pattern as workouts/sessions via
/// `GitHubAPIClient`). Supersedes `CoachingInsightsView`. See `AGENTS.md` → Warm Instrument
/// Home, `kdb/decisions/0005-widget-snapshots-cross-platform.md`, and
/// `ui/docs/reference-interactions/Widget Design Philosophy.md` (platform row "iOS app (Home)").
struct WarmInstrumentHomeView: View {
    @EnvironmentObject var store: WidgetSnapshotStore
    @State private var toast: Toast?
    @State private var isEditingLayout = false
    @State private var navigationPath: [SyncCacheEntry] = []

    @AppStorage("wiEngineSize") private var engineSize = "M"
    @AppStorage("wiQuestSize") private var questSize = "M"
    @AppStorage("wiCommitmentsSize") private var commitmentsSize = "M"

    var body: some View {
        NavigationStack(path: $navigationPath) {
            VStack(spacing: 0) {
                BrandHeader(title: "Home", trailing: isEditingLayout ? AnyView(doneButton) : nil)

                if let snapshots = store.snapshots {
                    InstrumentHeaderView(
                        phase: snapshots.home.phase,
                        sync: snapshots.home.sync,
                        generatedAt: snapshots.generatedAt
                    )
                }

                ScrollView {
                    if let snapshots = store.snapshots {
                        widgetColumn(for: snapshots)
                    } else if store.isLoading {
                        ProgressView().padding(.top, 100)
                    } else {
                        emptyState
                    }
                }
                .refreshable { await store.refresh(showSpinner: false) }
            }
            .background(WarmInstrument.desk.ignoresSafeArea())
            .toast($toast)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: SyncCacheEntry.self) { entry in
                ActivityDetailView(entry: entry)
            }
            .task { await store.refresh(showSpinner: store.snapshots == nil) }
            .onChange(of: store.lastError) { _, newError in
                guard let newError else { return }
                Haptics.error()
                toast = Toast(kind: .error, message: newError)
            }
        }
    }

    // MARK: - Widget column

    @ViewBuilder
    private func widgetColumn(for snapshots: WidgetSnapshotsFile) -> some View {
        let home = snapshots.home
        LazyVStack(spacing: 14) {
            if !home.sync.healthy {
                SyncWarningBanner(sync: home.sync)
            }

            // P0
            EditableWidget(isEditing: $isEditingLayout, sizeBinding: $engineSize, sizeOptions: ["S", "M", "L"], jigglePhase: 0.00) {
                EngineWidget(size: WidgetSize(rawValue: engineSize) ?? .m, sizes: snapshots.sizes.engine)
            }

            EditableWidget(isEditing: $isEditingLayout, sizeBinding: $commitmentsSize, sizeOptions: ["S", "M"], jigglePhase: 0.05) {
                CommitmentCubesWidget(size: WidgetSize(rawValue: commitmentsSize) ?? .m, sizes: snapshots.sizes.commitments)
            }

            EditableWidget(isEditing: $isEditingLayout, sizeBinding: $questSize, sizeOptions: ["S", "M"], jigglePhase: 0.10) {
                QuestWidget(size: WidgetSize(rawValue: questSize) ?? .m, home: home.quest, small: snapshots.sizes.quest.S)
            }

            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.15) {
                RecentSessionsWidget(
                    sessions: home.sessions,
                    onOpen: { entry in
                        Haptics.tap()
                        navigationPath.append(entry)
                    },
                    onUnavailable: {
                        toast = Toast(kind: .info, message: "Sync this session to open it.")
                    }
                )
            }

            // P1 — plan chip-drag owns long-press, so it isn't wrapped in the
            // jiggle/size editor to avoid the two long-press gestures fighting.
            WeeklyPlanWidget(plan: home.plan)

            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.20) {
                TrainingActivityWidget(activity: home.trainingActivity)
            }

            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.25) {
                CoachReadWidget(read: home.coachRead)
            }

            // P2
            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.30) {
                BuildPhaseWidget(phase: home.phase)
            }

            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.35) {
                Vo2Widget(vo2: home.vo2)
            }

            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.40) {
                CaloriesWidget(calories: home.calories)
            }
        }
        .padding(16)
        .padding(.bottom, 24)
    }

    // MARK: - Header / states

    private var doneButton: some View {
        Button {
            Haptics.tap()
            withAnimation(.spring(duration: 0.3)) { isEditingLayout = false }
        } label: {
            Text("Done")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(WarmInstrument.accent)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "gauge.with.dots.needle.33percent")
                .font(.system(size: 36))
                .foregroundColor(WarmInstrument.accent)
            Text("Home isn't synced yet")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
            Text("Pull down to fetch this week's snapshot.")
                .font(.system(size: 12))
                .foregroundColor(WarmInstrument.inkMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 100)
    }
}

// MARK: - Sync warning banner

/// The one "something's wrong" treatment (Design Philosophy's alarm color) applied to the
/// whole Home surface when the last sync round wasn't healthy — never stacked with other
/// alarms, shown once at the top of the column.
private struct SyncWarningBanner: View {
    let sync: WidgetSyncSnapshot

    var body: some View {
        WarmCard(padding: 12, fill: WarmInstrument.alarmBg) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(WarmInstrument.alarmFg)

                VStack(alignment: .leading, spacing: 4) {
                    Text(sync.label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(WarmInstrument.alarmFg)
                    ForEach(sync.warnings, id: \.self) { warning in
                        Text(warning)
                            .font(.system(size: 11))
                            .foregroundColor(WarmInstrument.alarmFg.opacity(0.85))
                    }
                }

                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Widget size

enum WidgetSize: String {
    case s = "S", m = "M", l = "L"
}

// MARK: - Editable widget wrapper (long-press jiggle + S/M/L picker)

/// Wraps a widget with the "iOS app (Home)" interaction budget: long-press (~550ms) enters
/// edit mode for the whole column (jiggle, ±1.4°), and — where the snapshot has size
/// variants — a small S/M/L picker appears on the widget. Swaps content in place; widgets
/// never reflow mid-edit (only the picked size changes, not position).
private struct EditableWidget<Content: View>: View {
    @Binding var isEditing: Bool
    var sizeBinding: Binding<String>? = nil
    var sizeOptions: [String] = []
    var jigglePhase: Double = 0
    @ViewBuilder var content: Content

    var body: some View {
        content
            .jiggling(isEditing, phase: jigglePhase)
            .overlay(alignment: .topTrailing) {
                if isEditing, let sizeBinding, !sizeOptions.isEmpty {
                    SizePickerBadge(size: sizeBinding, options: sizeOptions)
                        .offset(x: -10, y: -10)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .onLongPressGesture(minimumDuration: 0.55) {
                guard !isEditing else { return }
                Haptics.tap()
                withAnimation(.spring(duration: 0.3)) { isEditing = true }
            }
    }
}

private struct JiggleModifier: ViewModifier {
    let isActive: Bool
    let phase: Double
    @State private var animate = false

    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(isActive ? (animate ? 1.4 : -1.4) : 0))
            .animation(
                isActive
                    ? .easeInOut(duration: 0.15).repeatForever(autoreverses: true).delay(phase)
                    : .default,
                value: animate
            )
            .onChange(of: isActive) { _, active in animate = active }
            .onAppear { if isActive { animate = true } }
    }
}

private extension View {
    func jiggling(_ isActive: Bool, phase: Double = 0) -> some View {
        modifier(JiggleModifier(isActive: isActive, phase: phase))
    }
}

private struct SizePickerBadge: View {
    @Binding var size: String
    let options: [String]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                Button {
                    guard size != option else { return }
                    Haptics.tap()
                    withAnimation(.spring(duration: 0.25)) { size = option }
                } label: {
                    Text(option)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .frame(width: 22, height: 22)
                        .foregroundColor(size == option ? .white : WarmInstrument.inkMuted)
                        .background(size == option ? WarmInstrument.accent : Color.clear)
                        .clipShape(Circle())
                }
            }
        }
        .padding(3)
        .background(WarmInstrument.paper)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(WarmInstrument.border, lineWidth: 1))
        .shadow(color: WarmInstrument.cardShadow, radius: 6, x: 0, y: 3)
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
                    .background(Color(red: 0xc4 / 255, green: 0x8a / 255, blue: 0x2e / 255))
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

// MARK: - P0: Engine

private struct EngineWidget: View {
    let size: WidgetSize
    let sizes: EngineSizes

    var body: some View {
        WarmCard(padding: 18, fill: WarmInstrument.accent) {
            VStack(alignment: .leading, spacing: 14) {
                switch size {
                case .s:
                    header(weekLabel: sizes.S.weekLabel, signal: sizes.S.signal)
                    readout(load: sizes.S.load, verdict: sizes.S.compactVerdict)
                    bandStrip(load: sizes.S.load, bandLow: sizes.S.bandLow, bandHigh: sizes.S.bandHigh)
                case .m:
                    header(weekLabel: sizes.M.weekLabel, signal: sizes.M.signal)
                    readout(load: sizes.M.load, verdict: sizes.M.compactVerdict ?? sizes.M.verdict)
                    bandStrip(load: sizes.M.load, bandLow: sizes.M.bandLow, bandHigh: sizes.M.bandHigh)
                    trendSparkline(sizes.M.trend)
                case .l:
                    header(weekLabel: sizes.L.weekLabel, signal: sizes.L.signal)
                    readout(load: sizes.L.load, verdict: sizes.L.verdict)
                    bandStrip(load: sizes.L.load, bandLow: sizes.L.bandLow, bandHigh: sizes.L.bandHigh)
                    trendSparkline(sizes.L.trend)
                    mixBar(sizes.L.mix, totalHours: sizes.L.totalHours)
                    Text(sizes.L.method)
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundColor(.white.opacity(0.65))
                }
            }
        }
        .shadow(color: WarmInstrument.engineShadow, radius: 20, x: 0, y: 10)
    }

    private func header(weekLabel: String, signal: String) -> some View {
        HStack {
            Text("ENGINE · \(weekLabel)")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.1)
                .foregroundColor(.white.opacity(0.75))
            Spacer()
            Text(signal)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.1)
                .foregroundColor(.white)
        }
    }

    private func readout(load: Double, verdict: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(numberString(load))
                .font(.system(size: 44, weight: .heavy, design: .monospaced))
                .foregroundColor(.white)
                .contentTransition(.numericText())
            Text(verdict)
                .font(.system(size: 15, design: .serif).italic())
                .foregroundColor(.white.opacity(0.85))
        }
    }

    private func bandStrip(load: Double, bandLow: Double?, bandHigh: Double?) -> some View {
        GeometryReader { geo in
            let low = bandLow ?? load * 0.8
            let high = max(bandHigh ?? load * 1.2, low + 1)
            let scaleLow = min(low, load) * 0.85
            let scaleHigh = max(high, load) * 1.15 + 1
            let range = max(1, scaleHigh - scaleLow)
            let xLow = CGFloat((low - scaleLow) / range) * geo.size.width
            let xHigh = CGFloat((high - scaleLow) / range) * geo.size.width
            let xLoad = CGFloat((load - scaleLow) / range) * geo.size.width

            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.18)).frame(height: 6)
                Capsule()
                    .fill(Color.white.opacity(0.55))
                    .frame(width: max(10, xHigh - xLow), height: 10)
                    .offset(x: xLow)
                Circle()
                    .fill(Color.white)
                    .frame(width: 10, height: 10)
                    .offset(x: xLoad - 5)
            }
        }
        .frame(height: 12)
    }

    private func trendSparkline(_ points: [TrendPointSnapshot]) -> some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        return GeometryReader { geo in
            Path { path in
                for (index, point) in points.enumerated() {
                    let x = points.count > 1
                        ? geo.size.width * CGFloat(index) / CGFloat(points.count - 1)
                        : geo.size.width
                    let y = geo.size.height - geo.size.height * CGFloat((point.value - minV) / range)
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
        .frame(height: 40)
    }

    private func mixBar(_ mix: [LoadMixSnapshot], totalHours: Double) -> some View {
        let denominator = max(totalHours, mix.reduce(0) { $0 + $1.hours }, 1)
        return VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                HStack(spacing: 1) {
                    ForEach(mix.filter { $0.hours > 0 }) { item in
                        Rectangle()
                            .fill(WarmInstrument.color(hex: item.color))
                            .frame(width: geo.size.width * CGFloat(item.hours / denominator))
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 8)

            Text(String(format: "%.1fH LOGGED", totalHours))
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundColor(.white.opacity(0.7))
        }
    }

    private func numberString(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

// MARK: - P0: Sport commitment cubes

private struct CommitmentCubesWidget: View {
    let size: WidgetSize
    let sizes: CommitmentSizes

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 12) {
                CardKicker(label: "COMMITMENTS")
                if size == .s {
                    SportCube(commitment: sizes.S)
                } else if sizes.M.isEmpty {
                    Text("No commitments configured yet.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                } else {
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(sizes.M) { item in
                            SportCube(commitment: item)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - P0: Main & side quests

private struct QuestWidget: View {
    let size: WidgetSize
    let home: QuestSnapshot
    let small: QuestSnapshotS

    private var fraction: Double {
        size == .s
            ? small.progressPercent / 100
            : (home.target > 0 ? home.completed / home.target : 0)
    }

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                CardKicker(label: "MAIN QUEST")

                HStack(alignment: .firstTextBaseline) {
                    Text(size == .s ? small.name : home.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(1)
                    Spacer()
                    HStack(alignment: .firstTextBaseline, spacing: 1) {
                        Text(size == .s ? "\(Int(small.completed))" : "\(Int(home.completed))")
                            .font(WarmInstrument.figures(18, weight: .bold))
                        Text(size == .s ? " / \(Int(small.target))" : " / \(Int(home.target))")
                            .font(WarmInstrument.figures(12, weight: .semibold))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                    .foregroundColor(WarmInstrument.ink)
                    .contentTransition(.numericText())
                }

                HairlineProgress(fraction: fraction, height: 4)

                if size != .s, !home.sideQuests.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        MonoLabel("SIDE QUESTS", size: 9)
                        ForEach(home.sideQuests.prefix(2), id: \.name) { side in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(side.name)
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundColor(WarmInstrument.ink)
                                    Spacer()
                                    Text("\(Int(side.value))/\(Int(side.target))")
                                        .font(WarmInstrument.figures(11))
                                        .foregroundColor(WarmInstrument.inkMuted)
                                }
                                HairlineProgress(
                                    fraction: side.target > 0 ? side.value / side.target : 0,
                                    tint: WarmInstrument.color(hex: side.color),
                                    height: 3
                                )
                            }
                        }
                    }
                    .padding(.top, 4)
                }
            }
        }
    }
}

// MARK: - P0: Recent sessions

private struct RecentSessionsWidget: View {
    let sessions: [RecentSessionSnapshot]
    let onOpen: (SyncCacheEntry) -> Void
    let onUnavailable: () -> Void

    private var visible: [RecentSessionSnapshot] { Array(sessions.prefix(3)) }

    var body: some View {
        WarmCard(padding: 14) {
            VStack(alignment: .leading, spacing: 4) {
                CardKicker(label: "RECENT SESSIONS")
                    .padding(.horizontal, 2)
                    .padding(.bottom, 4)

                if visible.isEmpty {
                    Text("No sessions logged yet — nothing invented here.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, session in
                            SwipeToEditRow(onEdit: { handleEdit(session) }) {
                                SessionRow(session: session).padding(.horizontal, 2)
                            }
                            if index < visible.count - 1 {
                                Divider().overlay(WarmInstrument.headerRule)
                            }
                        }
                    }
                }
            }
        }
    }

    private func handleEdit(_ session: RecentSessionSnapshot) {
        let cache = SyncCache.load()
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

// MARK: - P1: Weekly plan

private struct WeeklyPlanWidget: View {
    let plan: WeeklyPlanSnapshot

    /// Local-only reorder state — resets to `plan.days` on next snapshot fetch. Writing the
    /// swap back to GitHub is listed as *Proposed* (not required) in the Design Philosophy's
    /// weekly-plan interaction note; this phase mirrors the web's client-side-only reorder.
    @State private var days: [PlanDaySnapshot]
    @State private var dragIndex: Int?

    init(plan: WeeklyPlanSnapshot) {
        self.plan = plan
        _days = State(initialValue: plan.days)
    }

    private var projection: (label: String, isOver: Bool) {
        let known = days.compactMap(\.loadDelta)
        guard !known.isEmpty else { return ("Projection unavailable", false) }
        let total = known.reduce(0, +)
        guard let low = plan.bandLow, let high = plan.bandHigh else {
            return ("Projected ≈\(Int(total)) — band unavailable.", false)
        }
        if total > high { return ("Projected ≈\(Int(total)) — over the band. Ease off.", true) }
        if total < low { return ("Projected ≈\(Int(total)) — below the band.", false) }
        return ("Projected ≈\(Int(total)) — in the band.", false)
    }

    var body: some View {
        WarmCard(dashed: true) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(plan.title ?? "WEEKLY PLAN")
                    Spacer()
                    MonoLabel(plan.statusLabel ?? (plan.isPreview ? "COACH DRAFT" : plan.label), color: WarmInstrument.accent)
                }

                HStack(spacing: 6) {
                    ForEach(Array(days.enumerated()), id: \.element.key) { index, day in
                        daySlot(day, index: index)
                    }
                }

                Text(projection.label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(projection.isOver ? WarmInstrument.accent : WarmInstrument.inkMuted)
            }
        }
        .onChange(of: plan.days.map(\.key)) { _, _ in days = plan.days }
    }

    private func daySlot(_ day: PlanDaySnapshot, index: Int) -> some View {
        VStack(spacing: 4) {
            Text(String(day.dayShort.prefix(1)))
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(WarmInstrument.inkFaint)

            VStack(spacing: 2) {
                if let glyph = day.glyph {
                    Image(systemName: WarmInstrument.sfSymbol(for: glyph))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(sportTint(day))
                } else {
                    Text("REST")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
                if let delta = day.loadDelta {
                    Text("+\(Int(delta))")
                        .font(.system(size: 8, weight: .semibold, design: .monospaced))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }
            .frame(width: 38, height: 38)
            .background(sportTint(day).opacity(day.glyph != nil ? 0.12 : 0))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(
                        dragIndex == index ? WarmInstrument.accent : WarmInstrument.border,
                        lineWidth: dragIndex == index ? 1.5 : 1
                    )
            )
        }
        .frame(maxWidth: .infinity)
        .onDrag {
            guard days[index].glyph != nil else { return NSItemProvider() }
            dragIndex = index
            return NSItemProvider(object: String(index) as NSString)
        }
        .onDrop(of: [.text], delegate: PlanDropDelegate(index: index, days: $days, dragIndex: $dragIndex))
    }

    private func sportTint(_ day: PlanDaySnapshot) -> Color {
        guard day.glyph != nil, let sportId = WarmSportId(rawValue: day.sport) else { return WarmInstrument.inkFaint }
        return WarmInstrument.sportColor(sportId)
    }
}

private struct PlanDropDelegate: DropDelegate {
    let index: Int
    @Binding var days: [PlanDaySnapshot]
    @Binding var dragIndex: Int?

    func performDrop(info: DropInfo) -> Bool {
        defer { dragIndex = nil }
        guard let from = dragIndex, from != index, days[from].glyph != nil else { return false }
        Haptics.tap()
        days.swapAt(from, index)
        return true
    }

    func dropEntered(info: DropInfo) {}
}

// MARK: - P1: Training activity heatmap

private struct TrainingActivityWidget: View {
    let activity: TrainingActivitySnapshot

    @State private var windowStart: Int

    init(activity: TrainingActivitySnapshot) {
        self.activity = activity
        _windowStart = State(initialValue: max(0, activity.months.count - 1))
    }

    private static let legend: [(WarmSportId, String)] = [
        (.badminton, "BDM"), (.calisthenics, "CAL"), (.foundation, "FDN"), (.cycling, "RIDE"),
        (.run, "RUN"), (.strength, "STR"), (.weightTraining, "WGT"), (.hike, "HIK"),
        (.walk, "WLK"), (.cricket, "CRK"), (.football, "FBL"), (.workout, "WKT"), (.swim, "SWM"),
    ]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 7)

    private var visibleMonth: ActivityMonthSnapshot? {
        activity.months.indices.contains(windowStart) ? activity.months[windowStart] : nil
    }

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(visibleMonth.map { "ACTIVITY · \($0.label)" } ?? "ACTIVITY")
                    Spacer()
                    if !activity.months.isEmpty {
                        HStack(spacing: 4) {
                            pageButton(system: "chevron.left", enabled: windowStart > 0) { windowStart -= 1 }
                            pageButton(system: "chevron.right", enabled: windowStart < activity.months.count - 1) { windowStart += 1 }
                        }
                    }
                }

                if activity.months.isEmpty {
                    Text("No training activity logged yet.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                }

                if let month = visibleMonth {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 3) {
                            ForEach(Array("MTWTFSS".enumerated()), id: \.offset) { _, ch in
                                Text(String(ch))
                                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                                    .foregroundColor(WarmInstrument.inkFaint)
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        LazyVGrid(columns: columns, spacing: 3) {
                            ForEach(Array(month.cells.enumerated()), id: \.offset) { _, cell in
                                RoundedRectangle(cornerRadius: 3, style: .continuous)
                                    .fill(cellColor(cell))
                                    .aspectRatio(1, contentMode: .fit)
                            }
                        }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(Self.legend, id: \.1) { sport, label in
                                HStack(spacing: 3) {
                                    Circle().fill(WarmInstrument.sportColor(sport)).frame(width: 6, height: 6)
                                    Text(label)
                                        .font(.system(size: 8, weight: .semibold, design: .monospaced))
                                        .foregroundColor(WarmInstrument.inkMuted)
                                }
                            }
                        }
                    }
                }

                HStack(spacing: 18) {
                    stat("\(activity.longestBlock)D", "LONGEST BLOCK")
                    stat(activity.planTruePercent.map { "\(Int($0))%" } ?? "—", "PLAN-TRUE")
                    stat("\(activity.gapCount)", "GAPS · WORST \(activity.worstGap)D")
                }

                Text(activity.read)
                    .font(.system(size: 11))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }

    private func pageButton(system: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            withAnimation(.spring(duration: 0.25)) { action() }
        } label: {
            Image(systemName: system)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(enabled ? WarmInstrument.ink : WarmInstrument.inkFaint)
                .frame(width: 24, height: 24)
                .background(WarmInstrument.surfaceMuted)
                .clipShape(Circle())
        }
        .disabled(!enabled)
    }

    private func cellColor(_ cell: ActivityCellState) -> Color {
        switch cell {
        case .empty: return WarmInstrument.border
        case .plannedMissed: return WarmInstrument.alarmBg
        default:
            guard let sport = WarmSportId(rawValue: cell.rawValue) else { return WarmInstrument.inkFaint }
            return WarmInstrument.sportColor(sport)
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(WarmInstrument.figures(14, weight: .bold))
                .foregroundColor(WarmInstrument.ink)
            MonoLabel(label, size: 8)
        }
    }
}

// MARK: - P1: Coach's read

private struct CoachReadWidget: View {
    let read: CoachReadSnapshot

    var body: some View {
        WarmCard(fill: WarmInstrument.surfaceMuted) {
            VStack(alignment: .leading, spacing: 10) {
                MonoLabel("\(read.eyebrow ?? "COACH'S READ") · \(read.dateLabel)")
                Text(read.body)
                    .font(.system(size: 15, design: .serif).italic())
                    .foregroundColor(WarmInstrument.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(read.signature ?? "— PHELPS")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }
}

// MARK: - P2: Build phase

private struct BuildPhaseWidget: View {
    let phase: BuildPhaseSnapshot

    private let railLabels = ["BLOCK 1", "DELOAD", "BLOCK 2", "TEST"]

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(phase.title ?? "BUILD PHASE")
                    Spacer()
                    MonoLabel(phase.weekLabel, color: WarmInstrument.accent)
                }

                HStack(spacing: 4) {
                    ForEach(railLabels, id: \.self) { _ in
                        Capsule().fill(WarmInstrument.border).frame(height: 4)
                    }
                }
                HStack {
                    ForEach(railLabels, id: \.self) { label in
                        Text(label)
                            .font(.system(size: 7, weight: .bold, design: .monospaced))
                            .foregroundColor(WarmInstrument.inkFaint)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                if phase.milestones.isEmpty {
                    Text("No milestones tracked for this block yet.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(phase.milestones.prefix(3), id: \.name) { milestone in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(milestone.name)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(WarmInstrument.ink)
                                HStack(spacing: 4) {
                                    Text(milestone.current ?? milestone.baseline)
                                    Text("→")
                                    Text(milestone.target).fontWeight(.bold)
                                }
                                .font(WarmInstrument.figures(12))
                                .foregroundColor(WarmInstrument.inkMuted)

                                if let progress = milestone.progressPercent {
                                    HairlineProgress(fraction: progress / 100, height: 3)
                                }
                            }
                        }
                    }
                }

                Text(phase.read)
                    .font(.system(size: 11))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }
}

// MARK: - P2: VO2 max (opt-in empty)

private struct Vo2Widget: View {
    let vo2: Vo2Snapshot

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    MonoLabel("VO₂ MAX · 12 MO")
                    Spacer()
                    MonoLabel(
                        vo2.isAvailable ? (vo2.percentileLabel ?? "") : "NOT IMPORTED",
                        color: vo2.isAvailable ? WarmInstrument.accent : WarmInstrument.inkFaint
                    )
                }

                if vo2.isAvailable, let value = vo2.value {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(String(format: "%.1f", value))
                            .font(WarmInstrument.figures(28, weight: .bold))
                            .foregroundColor(WarmInstrument.ink)
                        if let delta = vo2.delta {
                            Text("ml/kg/min · ▲ \(String(format: "%.1f", delta))")
                                .font(.system(size: 11))
                                .foregroundColor(WarmInstrument.inkMuted)
                        }
                    }
                    if vo2.trend.count > 1 {
                        Vo2Sparkline(points: vo2.trend).frame(height: 36)
                    }
                } else {
                    Text("No Apple Health VO₂ observations")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                }

                Text(vo2.read)
                    .font(.system(size: 11))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }
}

private struct Vo2Sparkline: View {
    let points: [TrendPointSnapshot]

    var body: some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        GeometryReader { geo in
            Path { path in
                for (index, point) in points.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(max(1, points.count - 1))
                    let y = geo.size.height - geo.size.height * CGFloat((point.value - minV) / range)
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(WarmInstrument.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
    }
}

// MARK: - P2: Calories

private struct CaloriesWidget: View {
    let calories: CaloriesSnapshot

    /// Issue #68: the live pipeline can still ship a fabricated 12,000 kcal target with
    /// `targetIsFixture: false`, as if it were earned. Gate on all three signals — no target,
    /// an explicit fixture flag, or the known hardcoded value — so Home never renders it as
    /// real regardless of whether the upstream field is trustworthy yet.
    private static let knownFixtureHardcode: Double = 12_000

    private var hasTarget: Bool {
        guard let target = calories.target, target > 0 else { return false }
        if calories.targetIsFixture == true { return false }
        if target == Self.knownFixtureHardcode { return false }
        return true
    }

    private var progress: Double {
        hasTarget ? min(1, calories.current / calories.target!) : min(1, calories.pacePercent / 100)
    }

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    MonoLabel("CALORIES · \(calories.monthLabel)")
                    Spacer()
                    MonoLabel("\(calories.daysLeft)D LEFT")
                }

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(compact(calories.current))
                        .font(WarmInstrument.figures(26, weight: .bold))
                        .foregroundColor(WarmInstrument.ink)
                        .contentTransition(.numericText())
                    Text(hasTarget ? "/ \(compact(calories.target!)) KCAL" : "KCAL LOGGED")
                        .font(.system(size: 11))
                        .foregroundColor(WarmInstrument.inkMuted)
                }

                ZStack(alignment: .leading) {
                    HairlineProgress(fraction: progress, height: 6)
                    GeometryReader { geo in
                        Circle()
                            .fill(WarmInstrument.ink)
                            .frame(width: 6, height: 6)
                            .offset(x: geo.size.width * CGFloat(min(1, calories.pacePercent / 100)) - 3)
                    }
                    .frame(height: 6)
                }

                Text(hasTarget && calories.dailyNeeded != nil
                     ? "\(Int(calories.dailyNeeded!))/DAY NEEDED"
                     : "MONTH TO DATE")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }

    private func compact(_ value: Double) -> String {
        value >= 1000 ? String(format: "%.1fK", value / 1000) : "\(Int(value))"
    }
}

#Preview("Warm Instrument Home — golden dataset") {
    let store = WidgetSnapshotStore()
    store.snapshots = GoldenDataset.snapshots
    return WarmInstrumentHomeView()
        .environmentObject(store)
}
