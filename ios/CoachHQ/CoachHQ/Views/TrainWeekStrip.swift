import SwiftUI

/// Train Week Strip · L — seven cubes, pointer vs ring, chevron week list.
struct TrainWeekStrip: View {
    let week: WorkoutsPageSelector.TrainWeek
    let selectedDate: String
    @Binding var listOpen: Bool
    var onSelectDate: (String) -> Void

    private var selectedIndex: Int {
        week.days.firstIndex(where: { $0.date == selectedDate }) ?? week.days.firstIndex(where: \.isToday) ?? 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            cubes
            if listOpen {
                weekList
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: TrainLayout.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TrainLayout.cardRadius, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
        .shadow(color: WarmInstrument.cardShadow, radius: 14, y: 7)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("WK \(week.number)")
                .font(WarmInstrument.monoLabel(11))
                .tracking(1.2)
                .foregroundColor(WarmInstrument.ink)

            Spacer(minLength: 0)

            Button {
                withAnimation(.easeInOut(duration: 0.26)) { listOpen.toggle() }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .rotationEffect(.degrees(listOpen ? 180 : 0))
                    .frame(width: 26, height: 26)
                    .background(WarmInstrument.desk)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(listOpen ? "Hide the week" : "Show the week")
        }
    }

    private var cubes: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                let gap: CGFloat = 6
                let count = CGFloat(max(week.days.count, 1))
                let width = (geo.size.width - gap * (count - 1)) / count
                ZStack(alignment: .topLeading) {
                    cubeRing(width: width, gap: gap)
                    HStack(spacing: gap) {
                        ForEach(week.days) { day in
                            Button {
                                tapDay(day.date)
                            } label: {
                                TrainWeekCube(day: day)
                                    .frame(width: width, height: TrainLayout.cubeHeight)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .highPriorityGesture(
                                TapGesture().onEnded { tapDay(day.date) }
                            )
                        }
                    }
                }
            }
            .frame(height: TrainLayout.cubeHeight)
            .padding(.horizontal, 2)
            .padding(.top, 2)

            pointerRow
                .frame(height: 12)
        }
    }

    private func tapDay(_ date: String) {
        Haptics.tap()
        onSelectDate(date)
    }

    @ViewBuilder
    private func cubeRing(width: CGFloat, gap: CGFloat) -> some View {
        let selected = week.days[safe: selectedIndex]
        if selected?.isToday != true, selected != nil {
            let x = CGFloat(selectedIndex) * (width + gap)
            RoundedRectangle(cornerRadius: TrainLayout.cubeRingRadius, style: .continuous)
                .strokeBorder(WarmInstrument.ink, lineWidth: 1.5)
                .frame(width: width + 4, height: TrainLayout.cubeHeight + 4)
                .offset(x: x - 2, y: -2)
                .animation(.easeInOut(duration: 0.24), value: selectedIndex)
                .allowsHitTesting(false)
        }
    }

    private var pointerRow: some View {
        GeometryReader { geo in
            let gap: CGFloat = 6
            let count = CGFloat(max(week.days.count, 1))
            let width = (geo.size.width - gap * (count - 1)) / count
            let x = CGFloat(selectedIndex) * (width + gap)
            let selected = week.days[safe: selectedIndex]
            if selected?.isToday == true {
                TrainPointer()
                    .frame(width: 12, height: 7)
                    .offset(x: x + (width - 12) / 2, y: 2)
            }
        }
        .padding(.horizontal, 2)
        .allowsHitTesting(false)
    }

    private var weekList: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("THE WEEK")
                    .font(WarmInstrument.monoLabel(9))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.inkFaintText)
                Spacer()
                Text("DRAFTED BY PHELPS")
                    .font(WarmInstrument.monoLabel(8.5))
                    .tracking(1.0)
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            .padding(.bottom, 10)

            ForEach(Array(week.days.enumerated()), id: \.element.id) { _, day in
                Button {
                    tapDay(day.date)
                } label: {
                    TrainWeekListRow(day: day, isSelected: day.date == selectedDate)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .highPriorityGesture(
                    TapGesture().onEnded { tapDay(day.date) }
                )
                .opacity(1)
            }
        }
        .padding(.top, 8)
        .transition(.opacity.combined(with: .move(edge: .top)))
    }
}

private struct TrainWeekCube: View {
    let day: WorkoutsPageSelector.TrainDay

    private var isToday: Bool { day.isToday }
    private var isLogged: Bool { day.sessions.contains(where: { $0.status == .logged }) }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TrainLayout.cubeRadius, style: .continuous)
        VStack(spacing: 4) {
            Text(TrainFormat.weekday(day.date))
                .font(WarmInstrument.monoLabel(7.5))
                .tracking(0.6)
                .foregroundColor(labelColor)
            Text(TrainFormat.dayNumber(day.date))
                .font(WarmInstrument.monoLabel(13))
                .foregroundColor(dateColor)

            Spacer(minLength: 0)

            VStack(spacing: 2) {
                ForEach(Array(day.sessions.prefix(3))) { session in
                    Capsule()
                        .fill(WarmInstrument.sportColor(session.sport).opacity(session.status == .logged ? 1 : 0.45))
                        .frame(width: 12, height: 3)
                }
            }
            .frame(width: 12, height: 13, alignment: .bottom)

            Text(loadLabel)
                .font(WarmInstrument.monoLabel(9))
                .foregroundColor(loadColor)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(shape.fill(cubeFill))
        .overlay(shape.strokeBorder(cubeBorder, style: cubeStroke))
        .contentShape(Rectangle())
    }

    private var cubeFill: Color {
        if isToday { return WarmInstrument.ink }
        if isLogged { return TrainLayout.loggedFill }
        return Color.clear
    }

    private var cubeBorder: Color {
        if isToday { return WarmInstrument.ink }
        if isLogged { return WarmInstrument.borderTintBase.opacity(0.12) }
        if day.isRest { return WarmInstrument.borderTintBase.opacity(0.30) }
        return WarmInstrument.borderTintBase.opacity(0.38)
    }

    private var cubeStroke: StrokeStyle {
        if isToday || isLogged {
            return StrokeStyle(lineWidth: 1.5)
        }
        return StrokeStyle(lineWidth: 1.5, dash: [4, 3])
    }

    private var labelColor: Color {
        if isToday { return WarmInstrument.paper }
        return WarmInstrument.inkFaintText
    }

    private var dateColor: Color {
        if isToday { return WarmInstrument.paper }
        if isLogged { return WarmInstrument.ink }
        return WarmInstrument.inkFaint
    }

    private var loadLabel: String {
        if let load = day.observedLoad { return "+\(load)" }
        return "—"
    }

    private var loadColor: Color {
        if isToday { return WarmInstrument.paper.opacity(0.85) }
        if day.observedLoad != nil { return WarmInstrument.ink }
        return WarmInstrument.inkFaint
    }
}

private struct TrainWeekListRow: View {
    let day: WorkoutsPageSelector.TrainDay
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(TrainFormat.weekday(day.date))
                    .font(WarmInstrument.monoLabel(8))
                    .foregroundColor(WarmInstrument.inkFaintText)
                Text(TrainFormat.dayNumber(day.date))
                    .font(WarmInstrument.monoLabel(12))
                    .foregroundColor(WarmInstrument.ink)
            }
            .frame(width: 30, alignment: .leading)

            if day.isRest || day.sessions.isEmpty {
                Text("Rest")
                    .font(WarmInstrument.coachVoice(13))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(day.sessions) { session in
                        HStack(spacing: 8) {
                            Capsule()
                                .fill(WarmInstrument.sportColor(session.sport).opacity(session.status == .logged ? 1 : 0.45))
                                .frame(width: 16, height: 4)
                            Text(session.title)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(WarmInstrument.ink)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            Text(session.load.map { "+\($0)" } ?? "—")
                                .font(WarmInstrument.monoLabel(11))
                                .foregroundColor(session.load == nil ? WarmInstrument.inkFaint : WarmInstrument.ink)
                                .frame(width: 38, alignment: .trailing)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isSelected ? WarmInstrument.desk : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
    }
}

private struct TrainPointer: View {
    var body: some View {
        Canvas { gfx, size in
            var path = Path()
            path.move(to: CGPoint(x: 0, y: 0))
            path.addLine(to: CGPoint(x: size.width, y: 0))
            path.addLine(to: CGPoint(x: size.width / 2, y: size.height))
            path.closeSubpath()
            gfx.fill(path, with: .color(WarmInstrument.ink))
        }
    }
}

enum TrainLayout {
    /// Mock Day Card / Week Strip shell is 26pt; iOS Warm cards are 18. 22 sits between.
    static let cardRadius: CGFloat = 22
    static let cubeRadius: CGFloat = 14
    static let cubeHeight: CGFloat = 88
    static let cubeRingRadius: CGFloat = 15
    static let maxProtocolPhases = 3
    static let maxPhaseTitleChars = 12
    /// Logged cube fill `#f1ece2` on paper.
    static let loggedFill = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x27 / 255, green: 0x25 / 255, blue: 0x20 / 255, alpha: 1)
            : UIColor(red: 0xf1 / 255, green: 0xec / 255, blue: 0xe2 / 255, alpha: 1)
    })
}

enum TrainFormat {
    static func weekday(_ date: String) -> String {
        label(date, format: "EEE").uppercased()
    }

    static func dayNumber(_ date: String) -> String {
        label(date, format: "d")
    }

    static func dayHeader(_ date: String) -> String {
        label(date, format: "EEE d").uppercased()
    }

    static func sportCode(_ sport: WarmSportId) -> String {
        switch sport {
        case .badminton: return "BDM"
        case .calisthenics: return "CAL"
        case .foundation: return "FDN"
        case .cycling: return "RIDE"
        case .run: return "RUN"
        case .weightTraining: return "WT"
        case .strength: return "STR"
        case .hike: return "HKE"
        case .walk: return "WLK"
        case .cricket: return "CKT"
        case .football: return "FTB"
        case .workout: return "WKT"
        case .swim: return "SWM"
        case .tennis: return "TEN"
        case .other: return "OTH"
        }
    }

    private static func label(_ date: String, format: String) -> String {
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(identifier: "UTC")!
        let parser = DateFormatter()
        parser.calendar = utcCalendar
        parser.timeZone = utcCalendar.timeZone
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let parsed = parser.date(from: date) else { return date }
        let label = DateFormatter()
        label.calendar = utcCalendar
        label.timeZone = utcCalendar.timeZone
        label.locale = Locale(identifier: "en_US_POSIX")
        label.dateFormat = format
        return label.string(from: parsed)
    }
}
