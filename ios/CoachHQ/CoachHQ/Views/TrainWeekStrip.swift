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
        .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
        .shadow(color: WarmInstrument.cardShadow, radius: 14, y: 7)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(headerLeft)
                .font(WarmInstrument.monoLabel(11))
                .tracking(1.2)
                .foregroundColor(WarmInstrument.ink)

            Spacer(minLength: 0)

            if let verdict = week.bandVerdict {
                Text(verdict)
                    .font(WarmInstrument.coachVoice(13))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .lineLimit(1)
            }

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

    private var headerLeft: String {
        if let load = week.loggedLoad {
            return "WK \(week.number) · \(load)"
        }
        return "WK \(week.number) · —"
    }

    private var cubes: some View {
        HStack(spacing: 6) {
            ForEach(Array(week.days.enumerated()), id: \.element.id) { index, day in
                Button {
                    Haptics.tap()
                    onSelectDate(day.date)
                } label: {
                    TrainWeekCube(day: day)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 2)
        .padding(.bottom, 10)
        .overlay(alignment: .bottom) {
            marks
        }
    }

    private var marks: some View {
        GeometryReader { geo in
            let count = CGFloat(max(week.days.count, 1))
            let gap: CGFloat = 6
            let width = (geo.size.width - gap * (count - 1)) / count
            let x = CGFloat(selectedIndex) * (width + gap)
            let todayIndex = week.days.firstIndex(where: \.isToday)
            let selected = week.days[safe: selectedIndex]

            ZStack(alignment: .topLeading) {
                if selected?.isToday == true {
                    TrainPointer()
                        .frame(width: 12, height: 7)
                        .offset(x: x + (width - 12) / 2, y: geo.size.height - 7)
                } else if selected != nil {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(WarmInstrument.ink, lineWidth: 1.5)
                        .frame(width: width + 8, height: geo.size.height - 6)
                        .offset(x: x - 4, y: -4)
                        .animation(.easeInOut(duration: 0.24), value: selectedIndex)
                }

                if let todayIndex, todayIndex != selectedIndex, selected?.isToday != true {
                    // Pointer only while today is selected — ring owns the other days.
                    Color.clear
                }
            }
        }
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

            ForEach(Array(week.days.enumerated()), id: \.element.id) { index, day in
                Button {
                    Haptics.tap()
                    onSelectDate(day.date)
                } label: {
                    TrainWeekListRow(day: day, isSelected: day.date == selectedDate)
                }
                .buttonStyle(.plain)
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

    var body: some View {
        VStack(spacing: 6) {
            Text(TrainFormat.weekday(day.date))
                .font(WarmInstrument.monoLabel(7.5))
                .tracking(0.6)
                .foregroundColor(isToday ? WarmInstrument.paper : WarmInstrument.inkFaintText)
            Text(TrainFormat.dayNumber(day.date))
                .font(WarmInstrument.monoLabel(13))
                .foregroundColor(isToday ? WarmInstrument.paper : WarmInstrument.ink)

            Spacer(minLength: 0)

            HStack(spacing: 2) {
                ForEach(day.sessions) { session in
                    Capsule()
                        .fill(WarmInstrument.sportColor(session.sport).opacity(session.status == .logged ? 1 : 0.45))
                        .frame(width: 8, height: 3)
                }
            }
            .frame(height: 3)

            Text(loadLabel)
                .font(WarmInstrument.monoLabel(9))
                .foregroundColor(loadColor)
        }
        .padding(.horizontal, 4)
        .padding(.top, 7)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .frame(height: 88)
        .background(cubeFill)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(cubeBorder, style: cubeStroke)
        )
    }

    private var cubeFill: Color {
        if isToday { return WarmInstrument.ink }
        if day.sessions.contains(where: { $0.status == .logged }) { return WarmInstrument.desk }
        return Color.clear
    }

    private var cubeBorder: Color {
        if isToday { return WarmInstrument.ink }
        return WarmInstrument.borderDashed
    }

    private var cubeStroke: StrokeStyle {
        if isToday || day.sessions.contains(where: { $0.status == .logged }) {
            return StrokeStyle(lineWidth: 1.5)
        }
        return StrokeStyle(lineWidth: 1.5, dash: [4, 3])
    }

    private var loadLabel: String {
        if let load = day.observedLoad { return "+\(load)" }
        if day.isRest || day.sessions.allSatisfy({ $0.status == .draft }) { return "—" }
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
        .background(isSelected ? WarmInstrument.desk : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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
