import SwiftUI

// MARK: - Day grouping

struct DayGroup: Identifiable {
    let id: String       // YYYY-MM-DD
    let label: String    // "Today", "Yesterday", "Wed 8 Jul"
    let entries: [SyncCacheEntry]
}

private let _dayFmt: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current; return f
}()
private let _inputFmt: DateFormatter = {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"; f.timeZone = .current; return f
}()

func groupByDay(_ entries: [SyncCacheEntry]) -> [DayGroup] {
    let cal = Calendar.current
    let today = cal.startOfDay(for: Date())
    let yesterday = cal.date(byAdding: .day, value: -1, to: today)!
    let buckets = Dictionary(grouping: entries) { e -> String in
        guard let d = _inputFmt.date(from: e.startDateLocal) else { return "" }
        return _dayFmt.string(from: d)
    }
    return buckets
        .filter { !$0.key.isEmpty }
        .sorted { $0.key > $1.key }
        .map { dateStr, dayEntries in
            let label: String
            if let d = _dayFmt.date(from: dateStr) {
                let s = cal.startOfDay(for: d)
                if s == today            { label = "Today" }
                else if s == yesterday   { label = "Yesterday" }
                else                     { label = d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) }
            } else { label = dateStr }
            return DayGroup(id: dateStr, label: label,
                            entries: dayEntries.sorted { $0.startDateLocal > $1.startDateLocal })
        }
}

// MARK: - Shared components

/// 5 small HR zone circles: filled at zone color if ≥8% time in that zone, else dimmed.
struct ZoneDots: View {
    let zones: [String: HRZoneEntry]?

    private var fractions: [Double] {
        let order = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]
        let vals = order.map { zones?[$0]?.seconds ?? 0 }
        let total = vals.reduce(0, +)
        guard total > 0 else { return Array(repeating: 0, count: 5) }
        return vals.map { $0 / total }
    }

    var body: some View {
        HStack(spacing: 3) {
            ForEach(fractions.indices, id: \.self) { i in
                Circle()
                    .fill(Theme.hrZoneColors[i])
                    .frame(width: 6, height: 6)
                    .opacity(fractions[i] > 0.08 ? 1.0 : 0.18)
            }
        }
    }
}

/// Proportional horizontal zone bar: 5 segments, animated on appear.
struct CompactZoneBar: View {
    let zones: [String: HRZoneEntry]?
    var height: CGFloat = 5
    var rounded: Bool = true
    var animateEntrance: Bool = true
    @State private var appeared: Bool

    init(
        zones: [String: HRZoneEntry]?,
        height: CGFloat = 5,
        rounded: Bool = true,
        animateEntrance: Bool = true
    ) {
        self.zones = zones
        self.height = height
        self.rounded = rounded
        self.animateEntrance = animateEntrance
        _appeared = State(initialValue: !animateEntrance)
    }

    private var fractions: [Double] {
        let order = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]
        let vals = order.map { zones?[$0]?.seconds ?? 0 }
        let total = vals.reduce(0, +)
        guard total > 0 else { return [] }
        return vals.map { $0 / total }
    }

    var body: some View {
        if !fractions.isEmpty {
            GeometryReader { geo in
                HStack(spacing: 1) {
                    ForEach(fractions.indices, id: \.self) { i in
                        Theme.hrZoneColors[i]
                            .frame(width: max(1, geo.size.width * (appeared ? fractions[i] : 0)))
                            .animation(
                                .spring(duration: 0.5, bounce: 0.05).delay(Double(i) * 0.06),
                                value: appeared
                            )
                    }
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: rounded ? height / 2 : 0))
            .onAppear {
                guard animateEntrance else { return }
                appeared = true
            }
            .onDisappear {
                guard animateEntrance else { return }
                appeared = false
            }
        }
    }
}

// MARK: - Week summary widget

struct WeekSummaryWidget: View {
    let entries: [SyncCacheEntry]

    private var sessionCount: Int { entries.count }
    private var totalSeconds: Int { entries.reduce(0) { $0 + $1.elapsedTime } }

    private var activeDayCount: Int {
        let cal = Calendar.current
        let days = Set(entries.compactMap { e -> String? in
            guard let d = _inputFmt.date(from: e.startDateLocal) else { return nil }
            return _dayFmt.string(from: cal.startOfDay(for: d))
        })
        return days.count
    }

    private var timeString: String {
        let h = totalSeconds / 3600, m = (totalSeconds % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    private struct DayDot {
        let color: Color; let isToday: Bool; let isEmpty: Bool; let isFuture: Bool
    }

    private var dots: [DayDot] {
        let cal = Calendar.current; let today = Date()
        let daysSince = (cal.component(.weekday, from: today) + 5) % 7
        guard let monday = cal.date(byAdding: .day, value: -daysSince, to: cal.startOfDay(for: today)) else { return [] }
        let map = Dictionary(grouping: entries) { e -> String in
            guard let d = _inputFmt.date(from: e.startDateLocal) else { return "" }
            return _dayFmt.string(from: d)
        }
        return (0..<7).compactMap { i -> DayDot? in
            guard let date = cal.date(byAdding: .day, value: i, to: monday) else { return nil }
            let ds = _dayFmt.string(from: date)
            let de = map[ds] ?? []
            return DayDot(color: Theme.sportBadge(for: de.first?.sportType ?? "").color,
                          isToday: cal.isDateInToday(date), isEmpty: de.isEmpty, isFuture: date > today)
        }
    }

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    MonoLabel("This week", tracking: 2)
                    Spacer()
                    HStack(spacing: 6) {
                        ForEach(dots.indices, id: \.self) { i in
                            let d = dots[i]
                            Circle()
                                .fill(d.isFuture || d.isEmpty ? WarmInstrument.surfaceMuted : d.color)
                                .frame(width: 9, height: 9)
                                .overlay(Circle().stroke(
                                    d.isToday ? Theme.ink.opacity(0.45) : Color.clear,
                                    lineWidth: 1.5))
                        }
                    }
                }

                HStack(alignment: .bottom, spacing: 0) {
                    WeekStatCell(value: "\(sessionCount)", label: "SESSIONS")
                    WeekStatCell(value: timeString, label: "ACTIVE")
                    WeekStatCell(value: "\(activeDayCount) / 7", label: "DAYS")
                }
            }
        }
    }
}

private struct WeekStatCell: View {
    let value: String; let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 22, weight: .bold, design: .monospaced))
                .foregroundColor(Theme.ink)
                .contentTransition(.numericText())
            MonoLabel(label, size: 9)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Ledger row

/// Receipt-style activity row — date · sport vein · title · load. Mirrors `SessionRow` for
/// `SyncCacheEntry` data from the local sync cache.
struct ActivityLedgerRow: View {
    let entry: SyncCacheEntry

    private var sportColor: Color { Theme.sportBadge(for: entry.sportType).color }

    private var timeString: String {
        guard let d = _inputFmt.date(from: entry.startDateLocal) else { return "" }
        return d.formatted(date: .omitted, time: .shortened)
    }

    private var monoTimeLabel: String {
        guard let d = _inputFmt.date(from: entry.startDateLocal) else { return "" }
        return d.formatted(date: .omitted, time: .shortened).uppercased()
    }

    private var calories: Int? { entry.activity?.calories ?? entry.calories }

    private var trailingValue: String {
        if let cal = calories { return "\(cal)" }
        let h = entry.elapsedTime / 3600, m = (entry.elapsedTime % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        HStack(spacing: 10) {
            MonoLabel(monoTimeLabel, size: 9, color: WarmInstrument.inkFaint, tracking: 0.6)
                .frame(width: 46, alignment: .leading)

            RoundedRectangle(cornerRadius: 2)
                .fill(sportColor)
                .frame(width: 3, height: 30)

            VStack(alignment: .leading, spacing: 1) {
                Text(entry.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Text(timeString)
                        .font(.system(size: 11))
                        .foregroundColor(WarmInstrument.inkMuted)
                    if let zones = entry.activity?.hrZones {
                        ZoneDots(zones: zones)
                    }
                    if entry.sportType == "Badminton" && !entry.hasDescription {
                        Circle().fill(Theme.attentionOrange).frame(width: 5, height: 5)
                    }
                }
            }

            Spacer(minLength: 8)

            Text(trailingValue)
                .font(WarmInstrument.figures(14, weight: .bold))
                .foregroundColor(sportColor)
                .contentTransition(.numericText())
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

// MARK: - Activity feed

/// Week summary + single ledger card with inline day groups. Taps via parent `onSelect`.
struct ActivityFeedView: View {
    let entries: [SyncCacheEntry]
    let grouped: [DayGroup]
    let onSelect: (SyncCacheEntry) -> Void
    /// When false, rows appear instantly — use for embedded pushes from Home.
    var animateEntrance: Bool = true

    private var sessionLabel: String {
        entries.count == 1 ? "1 SESSION" : "\(entries.count) SESSIONS"
    }

    var body: some View {
        LazyVStack(spacing: 0) {
            weekSummary
            ledgerCard
            Color.clear.frame(height: 12)
        }
    }

    @ViewBuilder
    private var weekSummary: some View {
        let widget = WeekSummaryWidget(entries: entries)
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 8)
        if animateEntrance {
            widget.staggerReveal(delay: PremiumMotion.staggerDelay(index: 0))
        } else {
            widget
        }
    }

    @ViewBuilder
    private var ledgerCard: some View {
        let card = WarmCard {
            VStack(alignment: .leading, spacing: 0) {
                CardKicker(label: "LAST 7 DAYS", trailing: sessionLabel)
                    .padding(.bottom, 12)

                ForEach(Array(grouped.enumerated()), id: \.element.id) { groupIndex, group in
                    dayHeader(groupIndex: groupIndex, label: group.label)

                    ForEach(Array(group.entries.enumerated()), id: \.element.id) { entryIndex, entry in
                        Button {
                            onSelect(entry)
                        } label: {
                            ActivityLedgerRow(entry: entry)
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(RowPressButtonStyle())
                        .modifier(OptionalStaggerReveal(
                            animate: animateEntrance,
                            delay: PremiumMotion.staggerDelay(index: revealIndex(groupIndex: groupIndex, entryIndex: entryIndex))
                        ))

                        if !isLastRow(groupIndex: groupIndex, entryIndex: entryIndex) {
                            Divider()
                                .overlay(WarmInstrument.headerRule)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)

        if animateEntrance {
            card.staggerReveal(delay: PremiumMotion.staggerDelay(index: 1))
        } else {
            card
        }
    }

    @ViewBuilder
    private func dayHeader(groupIndex: Int, label: String) -> some View {
        let header = MonoLabel(label, size: 11, tracking: 1.5)
            .padding(.top, groupIndex == 0 ? 0 : 16)
            .padding(.bottom, 8)
        if animateEntrance {
            header.staggerReveal(delay: PremiumMotion.staggerDelay(index: revealIndex(groupIndex: groupIndex, entryIndex: -1)))
        } else {
            header
        }
    }

    /// Global stagger index: week summary = 0, ledger card = 1, then headers + rows.
    private func revealIndex(groupIndex: Int, entryIndex: Int) -> Int {
        var index = 2
        for g in 0..<groupIndex {
            index += 1 + grouped[g].entries.count
        }
        if entryIndex < 0 { return index }
        return index + 1 + entryIndex
    }

    private func isLastRow(groupIndex: Int, entryIndex: Int) -> Bool {
        groupIndex == grouped.count - 1 && entryIndex == grouped[groupIndex].entries.count - 1
    }
}

/// Applies stagger reveal only when `animate` is true.
private struct OptionalStaggerReveal: ViewModifier {
    let animate: Bool
    let delay: Double

    func body(content: Content) -> some View {
        if animate {
            content.staggerReveal(delay: delay)
        } else {
            content
        }
    }
}
