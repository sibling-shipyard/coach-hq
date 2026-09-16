import SwiftUI

/// Train Day Card — five slots, fixed height. Empty slots stay empty so title/ribbon/footer
/// do not jump when the day changes.
struct TrainDayCard: View {
    let day: WorkoutsPageSelector.TrainDay
    let focusIndex: Int
    var onFocus: (Int) -> Void
    var onOpen: (WorkoutsPageSelector.TrainSession) -> Void
    var onSwipe: (Int) -> Void

    @EnvironmentObject private var authManager: GitHubAuthManager
    @State private var hrStream: HRStreamFile?

    init(
        day: WorkoutsPageSelector.TrainDay,
        focusIndex: Int,
        onFocus: @escaping (Int) -> Void,
        onOpen: @escaping (WorkoutsPageSelector.TrainSession) -> Void,
        onSwipe: @escaping (Int) -> Void
    ) {
        self.day = day
        self.focusIndex = focusIndex
        self.onFocus = onFocus
        self.onOpen = onOpen
        self.onSwipe = onSwipe
        let focused = day.sessions[safe: focusIndex] ?? day.sessions.first
        if let uuid = focused?.activity?.activity?.activityId, HRStreamCache.contains(uuid) {
            _hrStream = State(initialValue: HRStreamCache.lookup(uuid))
        }
    }

    private var session: WorkoutsPageSelector.TrainSession? {
        day.sessions[safe: focusIndex] ?? day.sessions.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header.frame(height: 14)
            titleBlock.frame(height: 56, alignment: .top)
            ribbon.frame(height: 66, alignment: .bottom)
            coachLine.frame(height: 32, alignment: .top)
            footer.frame(height: 46, alignment: .top)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 276)
        .background(shellFill)
        .clipShape(RoundedRectangle(cornerRadius: TrainLayout.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TrainLayout.cardRadius, style: .continuous)
                .strokeBorder(shellBorder, style: shellStroke)
        )
        .shadow(color: shellShadow, radius: 14, y: 7)
        .contentShape(Rectangle())
        .onTapGesture { openFocused() }
        .simultaneousGesture(swipeGesture)
        .task(id: session?.activity?.activity?.activityId) {
            await loadStream()
        }
    }

    // MARK: - Slots

    private var header: some View {
        HStack {
            Text(headerLeft)
                .font(WarmInstrument.monoLabel(9))
                .tracking(1.4)
                .foregroundColor(day.isToday ? WarmInstrument.ink : WarmInstrument.inkFaintText)
            Spacer(minLength: 0)
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsPills {
                pillRow
            } else {
                Color.clear.frame(height: 22)
            }
            Text(session?.title ?? restTitle)
                .font(.system(size: 28, weight: .semibold))
                .tracking(-0.4)
                .foregroundColor(WarmInstrument.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private var pillRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if day.sessions.count == 1, let session, session.status == .draft {
                    TrainPill(title: "COACH DRAFT", filled: false)
                } else {
                    ForEach(Array(day.sessions.enumerated()), id: \.element.id) { index, item in
                        Button {
                            tapFocus(index)
                        } label: {
                            TrainPill(title: item.shortTitle, filled: index == focusIndex)
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .highPriorityGesture(
                            TapGesture().onEnded { tapFocus(index) }
                        )
                    }
                }
            }
        }
        .frame(height: 22)
    }

    @ViewBuilder
    private var ribbon: some View {
        if day.isRest || session == nil {
            Color.clear
        } else if let session, session.status == .logged {
            loggedRibbon(session)
        } else if let session, session.isProtocol, !session.phases.isEmpty {
            phaseBar(session)
        } else if let session, session.isMatchDraft {
            matchRibbon
        } else {
            Color.clear
        }
    }

    @ViewBuilder
    private var coachLine: some View {
        if day.isRest {
            coachText(day.coachNote ?? "Rest. Nothing drafted.")
        } else if day.isToday, let session, session.status == .draft, let note = session.coachNote, !note.isEmpty {
            coachText(note)
        } else {
            Color.clear
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            Rectangle()
                .fill(WarmInstrument.headerRule)
                .frame(height: 1)
            footerContent
        }
    }

    @ViewBuilder
    private var footerContent: some View {
        if day.isRest {
            HStack {
                Text("NOTHING DRAFTED")
                    .font(WarmInstrument.monoLabel(8))
                    .foregroundColor(WarmInstrument.inkFaintText)
                Spacer()
                Text("—")
                    .font(WarmInstrument.figures(15, weight: .bold))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
        } else if let session, session.status == .logged {
            receiptFooter(session)
        } else if day.isToday, let session, session.isProtocol {
            Button("DETAIL") { onOpen(session) }
                .buttonStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .contentShape(Rectangle())
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(WarmInstrument.border, lineWidth: 1)
                )
        } else {
            Color.clear
        }
    }

    // MARK: - Pieces

    private func loggedRibbon(_ session: WorkoutsPageSelector.TrainSession) -> some View {
        let zones = session.activity?.activity?.hrZones
        let colors = ribbonColors(session: session, zones: zones)
        return VStack(alignment: .leading, spacing: 6) {
            if colors.isEmpty {
                Color.clear
            } else {
                HStack(spacing: 1.5) {
                    ForEach(colors.indices, id: \.self) { i in
                        colors[i].frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            if let zones, !colors.isEmpty {
                legend(zones)
            }
        }
    }

    /// Same path as Activity Detail: measured stream when we have it, stored-zone estimate otherwise.
    private func ribbonColors(session: WorkoutsPageSelector.TrainSession, zones: [String: HRZoneEntry]?) -> [Color] {
        guard let zones, zones.values.contains(where: { $0.seconds > 0 }) else { return [] }
        if let stream = hrStream, !stream.points.isEmpty {
            let config = RibbonBuilder.storedConfig(from: zones)
            let cells = min(30, RibbonBuilder.cellCount(elapsedSeconds: stream.elapsedSeconds))
            let perCell = RibbonBuilder.zonesPerCell(stream: stream, config: config, cells: cells)
            return RibbonBuilder.carryGaps(perCell).map { HRZone.colors[$0] }
        }
        let elapsed = session.activity?.elapsedTime ?? (session.durationMin ?? 0) * 60
        let seed = session.activity?.fileName ?? session.id
        return RibbonBuilder.estimatedSequence(elapsedSeconds: elapsed, zones: zones, seedKey: seed)
            .map { HRZone.colors[$0] }
    }

    private func legend(_ zones: [String: HRZoneEntry]) -> some View {
        let items = HRZone.keys.indices.compactMap { i -> (Int, String, Int)? in
            let secs = Int(zones[HRZone.keys[i]]?.seconds ?? 0)
            guard secs >= 60 else { return nil }
            return (i, HRZone.names[i].uppercased(), secs / 60)
        }
        return HStack(spacing: 8) {
            ForEach(items, id: \.0) { item in
                HStack(spacing: 3) {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(HRZone.colors[item.0])
                        .frame(width: 7, height: 7)
                    Text("\(item.1) \(item.2)M")
                        .font(WarmInstrument.monoLabel(7))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }
        }
        .lineLimit(1)
    }

    private func phaseBar(_ session: WorkoutsPageSelector.TrainSession) -> some View {
        let phases = Array(session.phases.prefix(TrainLayout.maxProtocolPhases))
        let minutes = phases.map { phaseMinutes($0) }
        let total = max(minutes.reduce(0, +), 1)
        let color = WarmInstrument.sportColor(session.sport)
        return VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(Array(phases.enumerated()), id: \.element.id) { index, _ in
                        color.opacity(max(0.28, 1.0 - Double(index) * 0.18))
                            .frame(width: max(4, geo.size.width * (minutes[index] / total)))
                    }
                }
            }
            .frame(height: 10)
            .clipShape(Capsule())

            HStack {
                ForEach(phases) { phase in
                    Text(phaseTitle(phase.name))
                        .font(WarmInstrument.monoLabel(7))
                        .foregroundColor(WarmInstrument.inkFaintText)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                }
            }
        }
    }

    private func phaseTitle(_ name: String) -> String {
        let upper = name.uppercased()
        let limit = TrainLayout.maxPhaseTitleChars
        guard upper.count > limit else { return upper }
        return String(upper.prefix(limit - 1)) + "…"
    }

    private var matchRibbon: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle()
                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .foregroundColor(WarmInstrument.borderDashed)
                .frame(height: 2)
            Text("HOW IT WAS SPENT · AFTER THE MATCH")
                .font(WarmInstrument.monoLabel(8))
                .tracking(0.8)
                .foregroundColor(WarmInstrument.inkFaintText)
        }
    }

    private func receiptFooter(_ session: WorkoutsPageSelector.TrainSession) -> some View {
        HStack(alignment: .top, spacing: 0) {
            footerStat(durationLabel(session), "TIME", alignment: .leading)
            footerStat(session.load.map { "+\($0)" } ?? "—", "LOAD", accent: session.load != nil, alignment: .center)
            footerStat(calorieLabel(session), "KCAL", alignment: .trailing)
        }
    }

    private func durationLabel(_ session: WorkoutsPageSelector.TrainSession) -> String {
        guard let minutes = session.durationMin else { return "—" }
        return Format.duration(seconds: minutes * 60)
    }

    private func calorieLabel(_ session: WorkoutsPageSelector.TrainSession) -> String {
        guard let kcal = session.activity?.calories ?? session.activity?.activity?.calories else {
            return "—"
        }
        return "\(kcal)"
    }

    private func footerStat(
        _ value: String,
        _ label: String,
        accent: Bool = false,
        alignment: HorizontalAlignment = .leading
    ) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(value)
                .font(WarmInstrument.figures(15, weight: .bold))
                .foregroundColor(accent ? WarmInstrument.accent : WarmInstrument.ink)
            Text(label)
                .font(WarmInstrument.monoLabel(8))
                .foregroundColor(WarmInstrument.inkFaintText)
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .top))
    }

    private func coachText(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(text)
                .font(WarmInstrument.coachVoice(14.5))
                .foregroundColor(WarmInstrument.ink)
                .lineLimit(2)
            Spacer(minLength: 0)
            Text("— PHELPS")
                .font(WarmInstrument.monoLabel(8))
                .foregroundColor(WarmInstrument.inkFaint)
        }
    }

    // MARK: - Shell / copy

    private var headerLeft: String {
        let dayStamp = TrainFormat.dayHeader(day.date)
        if day.isToday { return "\(dayStamp) · TODAY" }
        if session?.status == .draft { return "\(dayStamp) · DRAFT" }
        return dayStamp
    }

    private var showsPills: Bool {
        day.sessions.count > 1 || (session?.status == .draft && session?.isMatchDraft != true)
    }

    private var restTitle: String { "Rest" }

    private var shellFill: Color {
        if day.kind == .future || day.isRest { return Color.clear }
        return WarmInstrument.paper
    }

    private var isLoggedShell: Bool { session?.status == .logged }

    private var shellBorder: Color {
        if day.isToday && !isLoggedShell { return WarmInstrument.ink.opacity(0.5) }
        return isLoggedShell ? WarmInstrument.border : WarmInstrument.borderDashed
    }

    private var shellStroke: StrokeStyle {
        isLoggedShell
            ? StrokeStyle(lineWidth: 1)
            : StrokeStyle(lineWidth: 1.5, dash: [5, 4])
    }

    private var shellShadow: Color {
        (day.kind == .future || day.isRest) ? .clear : WarmInstrument.cardShadow
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > abs(dy), abs(dx) >= 40 else { return }
                onSwipe(dx < 0 ? 1 : -1)
            }
    }

    private func tapFocus(_ index: Int) {
        Haptics.tap()
        onFocus(index)
    }

    private func openFocused() {
        guard let session else { return }
        if session.status == .logged, session.activity != nil {
            onOpen(session)
        } else if session.isProtocol {
            onOpen(session)
        }
    }

    private func phaseMinutes(_ phase: WorkoutPhase) -> CGFloat {
        CGFloat(Int(phase.duration.filter(\.isNumber)) ?? 1)
    }

    private func loadStream() async {
        guard let uuid = session?.activity?.activity?.activityId else {
            hrStream = nil
            return
        }
        if HRStreamCache.contains(uuid) {
            hrStream = HRStreamCache.lookup(uuid)
            return
        }
        await Task.yield()
        guard !Task.isCancelled else { return }
        do {
            let data = try await GitHubAPIClient(authManager: authManager)
                .readFile(path: "user_data/activities/streams/\(uuid).json")
            let decoded = try JSONDecoder().decode(HRStreamFile.self, from: data)
            HRStreamCache.store(uuid, stream: decoded)
            hrStream = decoded
        } catch {
            if HRStreamCache.shouldCacheAsMiss(error) {
                HRStreamCache.store(uuid, stream: nil)
            }
            hrStream = nil
        }
    }
}

private struct TrainPill: View {
    let title: String
    let filled: Bool

    var body: some View {
        Text(title.uppercased())
            .font(WarmInstrument.monoLabel(8))
            .tracking(0.6)
            .foregroundColor(filled ? WarmInstrument.paper : WarmInstrument.ink)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(filled ? WarmInstrument.ink : Color.clear)
            .clipShape(Capsule())
            .overlay(
                Capsule().strokeBorder(WarmInstrument.border, lineWidth: filled ? 0 : 1)
            )
            .contentShape(Capsule())
    }
}
