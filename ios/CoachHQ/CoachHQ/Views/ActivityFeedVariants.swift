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

/// Sticky day-group header.
struct DayGroupHeader: View {
    let label: String
    var body: some View {
        MonoLabel(label, size: 11, tracking: 1.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 7)
            .background(WarmInstrument.desk)
    }
}

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
    @State private var appeared = false

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
            .onAppear { appeared = true }
            .onDisappear { appeared = false }
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

// MARK: - Activity feed

/// Week summary + day-grouped icon rows. Taps are handled by the parent via `onSelect`.
struct ActivityFeedView: View {
    let entries: [SyncCacheEntry]
    let grouped: [DayGroup]
    let onSelect: (SyncCacheEntry) -> Void

    var body: some View {
        LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
            WeekSummaryWidget(entries: entries)
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 4)

            ForEach(grouped) { group in
                Section {
                    WarmCard(padding: 0) {
                        VStack(spacing: 0) {
                            ForEach(Array(group.entries.enumerated()), id: \.element.id) { idx, entry in
                                Button {
                                    onSelect(entry)
                                } label: {
                                    IconRow(entry: entry)
                                }
                                .buttonStyle(RowPressButtonStyle())

                                if idx < group.entries.count - 1 {
                                    Divider()
                                        .overlay(WarmInstrument.headerRule)
                                        .padding(.leading, 68)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                } header: {
                    DayGroupHeader(label: group.label)
                }
            }

            Color.clear.frame(height: 12)
        }
    }
}

private struct IconRow: View {
    let entry: SyncCacheEntry
    private var badge: (label: String, color: Color) { Theme.sportBadge(for: entry.sportType) }
    private var timeString: String {
        guard let d = _inputFmt.date(from: entry.startDateLocal) else { return "" }
        return d.formatted(date: .omitted, time: .shortened)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: Theme.sportIcon(for: entry.sportType))
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(badge.color)
                .frame(width: 40, height: 40)
                .background(badge.color.opacity(0.1))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(entry.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.ink)
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

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 1) {
                if let cal = entry.activity?.calories {
                    Text("\(cal)")
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.ink)
                        .contentTransition(.numericText())
                    MonoLabel("Cal", size: 8, tracking: 0.5)
                } else {
                    let h = entry.elapsedTime / 3600, m = (entry.elapsedTime % 3600) / 60
                    Text(h > 0 ? "\(h)h \(m)m" : "\(m)m")
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundColor(Theme.ink)
                    MonoLabel("Time", size: 8, tracking: 0.5)
                }
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(WarmInstrument.inkFaint)
                .padding(.leading, 4)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}
