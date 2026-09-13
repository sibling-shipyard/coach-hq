import SwiftUI

struct ActivityLedgerView: View {
    let entries: [SyncCacheEntry]
    let onSelect: (SyncCacheEntry) -> Void
    var onBack: (() -> Void)? = nil
    var footer: AnyView? = nil

    @State private var openWeekIDs: Set<String> = []
    @State private var pulledID: String?
    @State private var showingLoadSheet = false

    private var weeks: [ActivityLedgerWeek] {
        ActivityLedgerWeek.group(entries: entries)
    }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 26) {
            header

            ForEach(weeks) { week in
                ActivityLedgerWeekView(
                    week: week,
                    isOpen: openWeekIDs.contains(week.id),
                    pulledID: pulledID,
                    onToggle: { toggle(week) },
                    onPull: { pull($0) },
                    onOpen: onSelect
                )
            }

            if let footer {
                footer
                    .padding(.top, 2)
            }

            Color.clear.frame(height: 8)
        }
        .padding(.horizontal, 16)
        .padding(.top, 64)
        .padding(.bottom, 40)
        .onAppear(perform: seedInitialState)
        .onChange(of: entries.map(\.id)) { _, _ in seedInitialState() }
        .sheet(isPresented: $showingLoadSheet) {
            ActivityLedgerLoadSheet()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let onBack {
                Button {
                    LedgerHaptics.light()
                    onBack()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 10, weight: .bold))
                        Text("HQ")
                    }
                    .font(WarmInstrument.monoLabel(10, weight: .bold))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.inkMuted)
                }
                .buttonStyle(.plain)
            }

            Text("Activity Ledger")
                .font(.system(size: 30, weight: .semibold))
                .tracking(-0.9)
                .foregroundColor(WarmInstrument.ink)

            Button {
                LedgerHaptics.light()
                showingLoadSheet = true
            } label: {
                HStack(spacing: 4) {
                    Text("HOW IS LOAD COMPUTED?")
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                }
                .font(WarmInstrument.monoLabel(9.5, weight: .bold))
                .tracking(1.2)
                .foregroundColor(WarmInstrument.accent)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
    }

    private func seedInitialState() {
        guard let firstWeek = weeks.first else {
            openWeekIDs = []
            pulledID = nil
            return
        }

        if openWeekIDs.isEmpty {
            openWeekIDs = [firstWeek.id]
        }

        if pulledID == nil || !weeks.flatMap(\.items).contains(where: { $0.id == pulledID }) {
            pulledID = firstWeek.items.first?.id
        }
    }

    private func toggle(_ week: ActivityLedgerWeek) {
        withAnimation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.46).delay(0.06)) {
            if openWeekIDs.contains(week.id) {
                openWeekIDs.remove(week.id)
            } else {
                openWeekIDs.insert(week.id)
                pulledID = week.items.first?.id
            }
        }
        LedgerHaptics.rigid()
    }

    private func pull(_ item: ActivityLedgerItem) {
        guard pulledID != item.id else {
            onSelect(item.entry)
            LedgerHaptics.medium()
            return
        }

        withAnimation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.42)) {
            pulledID = item.id
        }
        LedgerHaptics.light()
    }
}

private struct ActivityLedgerWeekView: View {
    let week: ActivityLedgerWeek
    let isOpen: Bool
    let pulledID: String?
    let onToggle: () -> Void
    let onPull: (ActivityLedgerItem) -> Void
    let onOpen: (SyncCacheEntry) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: onToggle) {
                weekHeader
            }
            .buttonStyle(.plain)

            if isOpen {
                VStack(spacing: 0) {
                    ForEach(Array(week.items.enumerated()), id: \.element.id) { index, item in
                        let isPulled = pulledID == item.id
                        card(item: item, index: index, isPulled: isPulled)
                            .padding(.top, topMargin(index: index, isPulled: isPulled))
                            .zIndex(Double(week.items.count - index))
                            .onTapGesture {
                                if isPulled {
                                    onOpen(item.entry)
                                    LedgerHaptics.medium()
                                } else {
                                    onPull(item)
                                }
                            }
                    }
                }
                .padding(.top, 2)
                .transition(.opacity.combined(with: .move(edge: .top)))
            } else if let newest = week.items.first {
                Button(action: onToggle) {
                    ActivityLedgerClosedStack(item: newest, hiddenCount: max(0, week.items.count - 1))
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var weekHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("WK \(week.weekNumber)")
                    .font(WarmInstrument.monoLabel(10, weight: .bold))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.ink)
                Text(week.rangeLabel)
                    .font(WarmInstrument.monoLabel(9, weight: .bold))
                    .tracking(1.1)
                    .foregroundColor(WarmInstrument.inkFaintText)
            }

            Spacer(minLength: 8)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(week.loadLabel)
                    .font(WarmInstrument.figures(13, weight: .bold))
                    .foregroundColor(WarmInstrument.accent)
                    .contentTransition(.numericText())
                Text(week.verdict)
                    .font(WarmInstrument.coachVoice(13))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(WarmInstrument.inkFaintText)
                    .rotationEffect(.degrees(isOpen ? 0 : -90))
            }
        }
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
    }

    private func card(item: ActivityLedgerItem, index: Int, isPulled: Bool) -> some View {
        ActivityLedgerCard(item: item, isPulled: isPulled)
            .frame(height: ActivityLedgerMetrics.cardHeight)
            .frame(height: cardHeight(index: index, isPulled: isPulled), alignment: .bottom)
            .clipped()
    }

    private func cardHeight(index: Int, isPulled: Bool) -> CGFloat {
        if index == 0 {
            return isPulled ? ActivityLedgerMetrics.cardHeight : ActivityLedgerMetrics.peek
        }
        return ActivityLedgerMetrics.cardHeight
    }

    private func topMargin(index: Int, isPulled: Bool) -> CGFloat {
        guard index > 0 else { return 0 }
        return isPulled ? ActivityLedgerMetrics.pullGap : -ActivityLedgerMetrics.peek
    }
}

private struct ActivityLedgerCard: View {
    let item: ActivityLedgerItem
    let isPulled: Bool

    var body: some View {
        VStack(spacing: 0) {
            statsStrip
            row
        }
        .frame(maxWidth: .infinity)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
        .shadow(
            color: Color(red: 57 / 255.0, green: 52 / 255.0, blue: 42 / 255.0).opacity(isPulled ? 0.24 : 0.16),
            radius: isPulled ? 17 : 12,
            x: 0,
            y: isPulled ? 18 : 12
        )
        .scaleEffect(isPulled ? 1.012 : 1)
        .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.42), value: isPulled)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var row: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(item.sportColor)
                .frame(width: 3, height: 30)

            Image(systemName: item.sportIcon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(Color(red: 0x4a / 255.0, green: 0x4c / 255.0, blue: 0x46 / 255.0))
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.system(size: 15, weight: .semibold))
                    .tracking(-0.15)
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)

                Text(item.metaLine)
                    .font(WarmInstrument.monoLabel(9.5, weight: item.isToday ? .bold : .regular))
                    .tracking(0.5)
                    .foregroundColor(item.isToday ? WarmInstrument.accent : WarmInstrument.inkMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 10)

            Text(item.loadLabel)
                .font(WarmInstrument.figures(17, weight: .bold))
                .tracking(-0.5)
                .foregroundColor(WarmInstrument.ink)
                .contentTransition(.numericText())
        }
        .frame(height: ActivityLedgerMetrics.peek)
        .padding(.horizontal, 18)
    }

    private var statsStrip: some View {
        HStack(spacing: 10) {
            ForEach(item.stats) { stat in
                VStack(spacing: 4) {
                    Text(stat.value)
                        .font(WarmInstrument.figures(15, weight: .bold))
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text(stat.label)
                        .font(WarmInstrument.monoLabel(8, weight: .bold))
                        .tracking(1.05)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: ActivityLedgerMetrics.peek)
        .padding(.horizontal, 18)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(WarmInstrument.headerRule)
                .frame(height: 1)
        }
    }
}

private struct ActivityLedgerClosedStack: View {
    let item: ActivityLedgerItem
    let hiddenCount: Int

    var body: some View {
        VStack(spacing: 0) {
            ActivityLedgerCard(item: item, isPulled: false)
                .frame(height: ActivityLedgerMetrics.cardHeight)
                .frame(height: ActivityLedgerMetrics.peek, alignment: .bottom)
                .clipped()
                .overlay(alignment: .trailing) {
                    if hiddenCount > 0 {
                        Text("+\(hiddenCount) MORE")
                            .font(WarmInstrument.monoLabel(8.5, weight: .bold))
                            .tracking(0.9)
                            .foregroundColor(WarmInstrument.inkMuted)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(WarmInstrument.paper)
                            .overlay(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .strokeBorder(WarmInstrument.headerRule, lineWidth: 1)
                            )
                            .padding(.trailing, 18)
                    }
                }

            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(WarmInstrument.surfaceMuted.opacity(0.72))
                .frame(height: 9)
                .padding(.horizontal, 10)
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(WarmInstrument.surfaceMuted.opacity(0.95))
                .frame(height: 9)
                .padding(.horizontal, 20)
        }
    }
}

private struct ActivityLedgerLoadSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center) {
                Text("How load is computed")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                Spacer()
                Button("CLOSE") {
                    LedgerHaptics.light()
                    dismiss()
                }
                .font(WarmInstrument.monoLabel(10, weight: .bold))
                .tracking(1.1)
                .foregroundColor(WarmInstrument.inkMuted)
            }

            Text("LOAD = SUM ( MINUTES x ZONE WEIGHT )")
                .font(WarmInstrument.monoLabel(13, weight: .bold))
                .tracking(0.6)
                .foregroundColor(WarmInstrument.accent)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(WarmInstrument.accent.opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(WarmInstrument.accent.opacity(0.3), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            Text("Every minute is weighted by its heart-rate zone and summed. The same rule applies across sports.")
                .font(WarmInstrument.coachVoice(16))
                .foregroundColor(WarmInstrument.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                ForEach(ActivityLedgerMetrics.zoneWeights.indices, id: \.self) { index in
                    VStack(spacing: 5) {
                        Text("Z\(index + 1)")
                            .font(WarmInstrument.monoLabel(8.5, weight: .bold))
                            .tracking(0.8)
                            .foregroundColor(WarmInstrument.inkMuted)
                        Text("x\(ActivityLedgerMetrics.zoneWeights[index])")
                            .font(WarmInstrument.figures(15, weight: .bold))
                            .foregroundColor(WarmInstrument.ink)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(WarmInstrument.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }

            Text("WEEKLY BAND = YOUR 8-WEEK RHYTHM +/-20%")
                .font(WarmInstrument.monoLabel(9, weight: .bold))
                .tracking(1.1)
                .foregroundColor(WarmInstrument.inkFaintText)

            Text("Zone weights are provisional until the engine's canonical load constants are wired into iOS.")
                .font(WarmInstrument.coachVoice(13))
                .foregroundColor(WarmInstrument.inkMuted)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 20)
        .background(WarmInstrument.paper.ignoresSafeArea())
    }
}

private struct ActivityLedgerWeek: Identifiable {
    let id: String
    let weekNumber: Int
    let rangeLabel: String
    let items: [ActivityLedgerItem]

    var load: Int? {
        let values = items.compactMap(\.load)
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +)
    }

    var loadLabel: String {
        guard let load else { return "--" }
        return "+\(load)"
    }

    var verdict: String {
        guard let load else { return "load pending" }
        return load >= 250 ? "in the band" : "below the band"
    }

    static func group(entries: [SyncCacheEntry]) -> [ActivityLedgerWeek] {
        let items = entries.map(ActivityLedgerItem.init(entry:))
        let buckets = Dictionary(grouping: items) { $0.weekID }
        return buckets
            .map { _, groupedItems in
                let sortedItems = groupedItems.sorted { $0.startDate > $1.startDate }
                let first = sortedItems[0]
                return ActivityLedgerWeek(
                    id: first.weekID,
                    weekNumber: first.weekNumber,
                    rangeLabel: first.weekRangeLabel,
                    items: sortedItems
                )
            }
            .sorted { lhs, rhs in
                (lhs.items.first?.startDate ?? .distantPast) > (rhs.items.first?.startDate ?? .distantPast)
            }
    }
}

private struct ActivityLedgerItem: Identifiable {
    let id: String
    let entry: SyncCacheEntry
    let title: String
    let sportColor: Color
    let sportIcon: String
    let startDate: Date
    let dayLabel: String
    let timeLabel: String
    let durationLabel: String
    let isToday: Bool
    let weekID: String
    let weekNumber: Int
    let weekRangeLabel: String
    let load: Int?
    let stats: [ActivityLedgerStat]

    init(entry: SyncCacheEntry) {
        let activity = entry.activity
        let badge = Theme.sportBadge(for: entry.sportType)
        let date = ActivityLedgerFormat.parseDate(entry.startDateLocal) ?? .distantPast
        let load = ActivityLedgerLoad.compute(from: activity?.hrZones)

        self.id = entry.id
        self.entry = entry
        self.title = entry.name
        self.sportColor = badge.color
        self.sportIcon = Theme.sportIcon(for: entry.sportType)
        self.startDate = date
        self.dayLabel = ActivityLedgerFormat.dayLabel(for: date)
        self.timeLabel = ActivityLedgerFormat.timeLabel(for: date)
        self.durationLabel = ActivityLedgerFormat.compactDuration(seconds: entry.elapsedTime)
        self.isToday = Calendar.current.isDateInToday(date)
        self.weekID = ActivityLedgerFormat.weekID(for: date)
        self.weekNumber = ActivityLedgerFormat.weekNumber(for: date)
        self.weekRangeLabel = ActivityLedgerFormat.weekRangeLabel(for: date)
        self.load = load
        self.stats = ActivityLedgerStat.stats(for: entry, load: load)
    }

    var metaLine: String {
        [dayLabel, timeLabel, durationLabel]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    var loadLabel: String {
        guard let load else { return "--" }
        return "+\(load)"
    }
}

private struct ActivityLedgerStat: Identifiable {
    let id = UUID()
    let value: String
    let label: String

    static func stats(for entry: SyncCacheEntry, load: Int?) -> [ActivityLedgerStat] {
        let activity = entry.activity
        let sport = entry.sportType
        let loadValue = load.map { "+\($0)" } ?? "--"

        if sport == "Ride" || sport == "EBikeRide" || sport == "Cycling" {
            let km = ActivityLedgerFormat.kilometers(activity?.distance ?? entry.distance)
            let speed = ActivityLedgerFormat.kilometersPerHour(activity?.averageSpeed)
            return [
                ActivityLedgerStat(value: km, label: "KM"),
                ActivityLedgerStat(value: speed, label: "KM/H"),
                ActivityLedgerStat(value: ActivityLedgerFormat.bpm(entry.averageHeartrate ?? activity?.averageHeartrate), label: "AVG BPM"),
                ActivityLedgerStat(value: loadValue, label: "LOAD")
            ]
        }

        if sport == "Badminton" {
            return [
                ActivityLedgerStat(value: ActivityLedgerFormat.calories(activity?.calories ?? entry.calories), label: "KCAL"),
                ActivityLedgerStat(value: ActivityLedgerFormat.bpm(entry.averageHeartrate ?? activity?.averageHeartrate), label: "AVG BPM"),
                ActivityLedgerStat(value: ActivityLedgerFormat.bpm(entry.maxHeartrate ?? activity?.maxHeartrate), label: "PEAK BPM"),
                ActivityLedgerStat(value: loadValue, label: "LOAD")
            ]
        }

        return [
            ActivityLedgerStat(value: ActivityLedgerFormat.calories(activity?.calories ?? entry.calories), label: "KCAL"),
            ActivityLedgerStat(value: ActivityLedgerFormat.bpm(entry.averageHeartrate ?? activity?.averageHeartrate), label: "AVG BPM"),
            ActivityLedgerStat(value: "--", label: "SETS"),
            ActivityLedgerStat(value: loadValue, label: "LOAD")
        ]
    }
}

private enum ActivityLedgerLoad {
    static func compute(from zones: [String: HRZoneEntry]?) -> Int? {
        guard let zones else { return nil }
        var total = 0.0
        for (index, key) in HRZone.keys.enumerated() {
            let minutes = (zones[key]?.seconds ?? 0) / 60
            total += minutes * Double(ActivityLedgerMetrics.zoneWeights[index])
        }
        guard total > 0 else { return nil }
        return Int(total.rounded())
    }
}

private enum ActivityLedgerFormat {
    private static let inputFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        formatter.timeZone = .current
        return formatter
    }()

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE d"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let rangeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "d MMM"
        return formatter
    }()

    static func parseDate(_ string: String) -> Date? {
        inputFormatter.date(from: String(string.prefix(19)))
    }

    static func dayLabel(for date: Date) -> String {
        if Calendar.current.isDateInToday(date) { return "TODAY" }
        return dayFormatter.string(from: date).uppercased()
    }

    static func timeLabel(for date: Date) -> String {
        date == .distantPast ? "" : timeFormatter.string(from: date)
    }

    static func compactDuration(seconds: Int) -> String {
        let minutes = max(0, Int((Double(seconds) / 60).rounded()))
        let hours = minutes / 60
        let remainder = minutes % 60
        if hours > 0 {
            return remainder == 0 ? "\(hours)H" : "\(hours)H\(remainder)"
        }
        return "\(minutes)M"
    }

    static func calories(_ value: Int?) -> String {
        guard let value else { return "--" }
        return "\(value)"
    }

    static func bpm(_ value: Double?) -> String {
        guard let value else { return "--" }
        return "\(Int(value.rounded()))"
    }

    static func kilometers(_ meters: Double?) -> String {
        guard let meters, meters > 0 else { return "--" }
        return String(format: "%.1f", meters / 1000)
    }

    static func kilometersPerHour(_ metersPerSecond: Double?) -> String {
        guard let metersPerSecond, metersPerSecond > 0 else { return "--" }
        return String(format: "%.1f", metersPerSecond * 3.6)
    }

    static func weekID(for date: Date) -> String {
        let calendar = Calendar.current
        let year = calendar.component(.yearForWeekOfYear, from: date)
        let week = calendar.component(.weekOfYear, from: date)
        return "\(year)-\(week)"
    }

    static func weekNumber(for date: Date) -> Int {
        Calendar.current.component(.weekOfYear, from: date)
    }

    static func weekRangeLabel(for date: Date) -> String {
        let calendar = Calendar.current
        let weekday = calendar.component(.weekday, from: date)
        let daysSinceMonday = (weekday + 5) % 7
        guard
            let start = calendar.date(byAdding: .day, value: -daysSinceMonday, to: calendar.startOfDay(for: date)),
            let end = calendar.date(byAdding: .day, value: 6, to: start)
        else {
            return ""
        }

        return "\(rangeFormatter.string(from: start))-\(rangeFormatter.string(from: end))".uppercased()
    }
}

private enum ActivityLedgerMetrics {
    static let peek: CGFloat = 64
    static let cardHeight: CGFloat = 128
    static let pullGap: CGFloat = 12
    static let zoneWeights = [1, 2, 3, 4, 5]
}

private enum LedgerHaptics {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    static func rigid() {
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
    }
}
