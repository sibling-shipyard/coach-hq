import SwiftUI

/// Train Day Card — five slots, five voices. Height stays 314pt so the page does not jump.
struct TrainDayCard: View {
    let day: WorkoutsPageSelector.TrainDay
    let today: String
    let focusIndex: Int
    var onFocus: (Int) -> Void
    var onOpen: (WorkoutsPageSelector.TrainSession) -> Void
    var onJumpToday: () -> Void
    var onSwipe: (Int) -> Void

    @State private var hrStream: HRStreamFile?

    private var session: WorkoutsPageSelector.TrainSession? {
        day.sessions[safe: focusIndex] ?? day.sessions.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header.frame(height: 14)
            titleBlock.frame(height: 76, alignment: .top)
            ribbon.frame(height: 66, alignment: .bottom)
            coachLine.frame(height: 42, alignment: .top)
            footer.frame(height: 46, alignment: .bottom)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 314)
        .background(shellFill)
        .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                .strokeBorder(shellBorder, style: shellStroke)
        )
        .shadow(color: shellShadow, radius: 14, y: 7)
        .contentShape(Rectangle())
        .onTapGesture { openFocused() }
        .gesture(swipeGesture)
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
            if let session {
                Text(headerRight(session))
                    .font(WarmInstrument.monoLabel(9))
                    .foregroundColor(WarmInstrument.sportColor(session.sport))
            }
            if !day.isToday {
                Button("TODAY ›", action: onJumpToday)
                    .font(WarmInstrument.monoLabel(9))
                    .foregroundColor(WarmInstrument.ink)
                    .buttonStyle(.plain)
                    .padding(.leading, 8)
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            pillRow
            Text(session?.title ?? restTitle)
                .font(.system(size: 26, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(session?.subline ?? restSubline)
                .font(.system(size: 13.5))
                .foregroundColor(WarmInstrument.inkMuted)
                .lineLimit(1)
        }
    }

    private var pillRow: some View {
        HStack(spacing: 6) {
            if day.sessions.count <= 1 {
                if let session {
                    TrainPill(title: session.status == .logged ? "LOGGED" : "COACH DRAFT", filled: false)
                } else {
                    TrainPill(title: "REST", filled: false)
                }
            } else {
                ForEach(Array(day.sessions.enumerated()), id: \.element.id) { index, item in
                    Button {
                        Haptics.tap()
                        onFocus(index)
                    } label: {
                        TrainPill(title: item.shortTitle, filled: index == focusIndex)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(height: 18)
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

    @ViewBuilder
    private var footer: some View {
        if day.isRest {
            hairlineFooter(label: "NOTHING DRAFTED", value: "—")
        } else if let session, session.status == .logged {
            receiptFooter(session)
        } else if day.isToday, let session, session.isProtocol {
            Button("DETAIL") { onOpen(session) }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(WarmInstrument.border, lineWidth: 1)
                )
        } else {
            hairlineFooter(label: "PLANNED", value: session?.plannedMin.map { "\($0)M" } ?? "—")
        }
    }

    // MARK: - Pieces

    private func loggedRibbon(_ session: WorkoutsPageSelector.TrainSession) -> some View {
        let zones = session.activity?.activity?.hrZones
        let colors: [Color] = {
            guard let stream = hrStream, let zones, !stream.points.isEmpty else { return [] }
            let config = RibbonBuilder.storedConfig(from: zones)
            let cells = min(30, RibbonBuilder.cellCount(elapsedSeconds: stream.elapsedSeconds))
            let perCell = RibbonBuilder.zonesPerCell(stream: stream, config: config, cells: cells)
            return RibbonBuilder.carryGaps(perCell).map { HRZone.colors[$0] }
        }()
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
            if let zones {
                legend(zones)
            }
        }
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
        let minutes = session.phases.map { phaseMinutes($0) }
        let total = max(minutes.reduce(0, +), 1)
        let color = WarmInstrument.sportColor(session.sport)
        return VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(Array(session.phases.enumerated()), id: \.element.id) { index, _ in
                        color.opacity(max(0.28, 1.0 - Double(index) * 0.18))
                            .frame(width: max(4, geo.size.width * (minutes[index] / total)))
                    }
                }
            }
            .frame(height: 10)
            .clipShape(Capsule())

            HStack {
                ForEach(session.phases.prefix(4)) { phase in
                    Text(phase.name.uppercased())
                        .font(WarmInstrument.monoLabel(7))
                        .foregroundColor(WarmInstrument.inkFaintText)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                }
            }
        }
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
        HStack {
            footerStat(session.durationMin.map { "\($0)M" } ?? "—", "TIME")
            footerStat(session.load.map { "+\($0)" } ?? "—", "LOAD", accent: session.load != nil)
            footerStat(session.plannedMin.map { "\($0)M" } ?? "—", "PLANNED")
        }
    }

    private func footerStat(_ value: String, _ label: String, accent: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(WarmInstrument.figures(15, weight: .bold))
                .foregroundColor(accent ? WarmInstrument.accent : WarmInstrument.ink)
            Text(label)
                .font(WarmInstrument.monoLabel(8))
                .foregroundColor(WarmInstrument.inkFaintText)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func hairlineFooter(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(WarmInstrument.monoLabel(8))
                .foregroundColor(WarmInstrument.inkFaintText)
            Spacer()
            Text(value)
                .font(WarmInstrument.figures(15, weight: .bold))
                .foregroundColor(WarmInstrument.inkFaint)
        }
        .overlay(alignment: .top) {
            Rectangle().fill(WarmInstrument.headerRule).frame(height: 1)
        }
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
        if day.isRest { return "\(dayStamp) · REST" }
        if session?.status == .logged { return "\(dayStamp) · LOGGED" }
        return "\(dayStamp) · DRAFT"
    }

    private func headerRight(_ session: WorkoutsPageSelector.TrainSession) -> String {
        let code = TrainFormat.sportCode(session.sport)
        if session.status == .logged, let load = session.load {
            return "✓ \(code) · +\(load)"
        }
        return "\(code) · —"
    }

    private var restTitle: String { "Rest" }
    private var restSubline: String { "Nothing drafted" }

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
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                if value.translation.width <= -40 { onSwipe(1) }
                else if value.translation.width >= 40 { onSwipe(-1) }
            }
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
        hrStream = nil
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
    }
}
