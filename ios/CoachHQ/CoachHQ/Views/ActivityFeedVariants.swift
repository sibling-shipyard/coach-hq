import SwiftUI

// MARK: - Day grouping (shared by all variants)

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

/// Sticky day-group header used by Variants A and B.
struct DayGroupHeader: View {
    let label: String
    var body: some View {
        Text(label.uppercased())
            .font(.system(size: 11, weight: .bold))
            .kerning(1.5)
            .foregroundColor(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 7)
            .background(Color(uiColor: .systemBackground))
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

// MARK: - Week summary widget (Variants A)

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
        ThemedCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("THIS WEEK")
                        .font(.system(size: 10, weight: .bold)).kerning(2)
                        .foregroundColor(.secondary)
                    Spacer()
                    HStack(spacing: 6) {
                        ForEach(dots.indices, id: \.self) { i in
                            let d = dots[i]
                            Circle()
                                .fill(d.isFuture || d.isEmpty ? Theme.mutedBackground : d.color)
                                .frame(width: 9, height: 9)
                                .overlay(Circle().stroke(
                                    d.isToday ? Color.primary.opacity(0.45) : Color.clear,
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
                .foregroundColor(.primary)
                .contentTransition(.numericText())
            Text(label)
                .font(.system(size: 9, weight: .bold)).kerning(1)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - ═══ VARIANT 1 — Dashboard + Icon Rows ═══
//
// Top: week summary widget (sessions · time · days + dot strip)
// Feed: circular sport icon + name + zone dots + calories

struct FeedVariant1: View {
    let entries: [SyncCacheEntry]
    let grouped: [DayGroup]

    var body: some View {
        LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
            WeekSummaryWidget(entries: entries)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 4)

            ForEach(grouped) { group in
                Section {
                    ForEach(Array(group.entries.enumerated()), id: \.element.id) { idx, entry in
                        NavigationLink(value: entry) {
                            IconRow(entry: entry)
                        }
                        .buttonStyle(RowPressButtonStyle())
                        if idx < group.entries.count - 1 {
                            Divider().padding(.leading, 68)
                        }
                    }
                } header: {
                    DayGroupHeader(label: group.label)
                }
            }
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
            // Sport icon circle
            Image(systemName: Theme.sportIcon(for: entry.sportType))
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(badge.color)
                .frame(width: 40, height: 40)
                .background(badge.color.opacity(0.1))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(entry.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.primary)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Text(timeString)
                        .font(.system(size: 11)).foregroundColor(.secondary)
                    if let zones = entry.activity?.hrZones {
                        ZoneDots(zones: zones)
                    }
                    if entry.sportType == "Badminton" && !entry.hasDescription {
                        Circle().fill(Theme.attentionOrange).frame(width: 5, height: 5)
                    }
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 1) {
                if let cal = entry.activity?.calories {
                    Text("\(cal)")
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .foregroundColor(.primary)
                    Text("CAL")
                        .font(.system(size: 8, weight: .bold)).kerning(0.5)
                        .foregroundColor(.secondary)
                } else {
                    let h = entry.elapsedTime / 3600, m = (entry.elapsedTime % 3600) / 60
                    Text(h > 0 ? "\(h)h \(m)m" : "\(m)m")
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundColor(.primary)
                    Text("TIME")
                        .font(.system(size: 8, weight: .bold)).kerning(0.5)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - ═══ VARIANT 2 — Sport Cards with Full Zone Bar ═══
//
// Top: large bold stat banner (no card container — raw numbers pop)
// Feed: activity cards with sport-colored left bar, big watermark icon,
//        calories prominent right, full-width zone bar flush to card bottom

struct FeedVariant2: View {
    let entries: [SyncCacheEntry]
    let grouped: [DayGroup]

    var body: some View {
        LazyVStack(spacing: 0, pinnedViews: .sectionHeaders) {
            StatBanner(entries: entries)
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 16)

            Divider().opacity(0.5)

            ForEach(grouped) { group in
                Section {
                    VStack(spacing: 10) {
                        ForEach(group.entries) { entry in
                            NavigationLink(value: entry) {
                                SportCard(entry: entry)
                            }
                            .buttonStyle(CardPressButtonStyle())
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 4)
                } header: {
                    DayGroupHeader(label: group.label)
                }
            }
        }
    }
}

private struct StatBanner: View {
    let entries: [SyncCacheEntry]
    private var totalSecs: Int { entries.reduce(0) { $0 + $1.elapsedTime } }
    private var days: Int {
        let cal = Calendar.current
        return Set(entries.compactMap { e -> String? in
            guard let d = _inputFmt.date(from: e.startDateLocal) else { return nil }
            return _dayFmt.string(from: cal.startOfDay(for: d))
        }).count
    }
    private var timeStr: String {
        let h = totalSecs / 3600, m = (totalSecs % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        HStack(spacing: 0) {
            BannerStat(value: "\(entries.count)", label: "THIS WEEK")
            BannerStat(value: timeStr, label: "ACTIVE TIME")
            BannerStat(value: "\(days) / 7", label: "DAYS")
        }
    }
}

private struct BannerStat: View {
    let value: String; let label: String
    var body: some View {
        VStack(alignment: .center, spacing: 3) {
            Text(value)
                .font(.system(size: 26, weight: .black, design: .monospaced))
                .foregroundColor(.primary)
                .contentTransition(.numericText())
            Text(label)
                .font(.system(size: 8, weight: .bold)).kerning(1.5)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct SportCard: View {
    let entry: SyncCacheEntry
    private var badge: (label: String, color: Color) { Theme.sportBadge(for: entry.sportType) }
    private var timeStr: String {
        guard let d = _inputFmt.date(from: entry.startDateLocal) else { return "" }
        return d.formatted(date: .omitted, time: .shortened)
    }
    private var durStr: String {
        let h = entry.elapsedTime / 3600, m = (entry.elapsedTime % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                // Bold sport color left bar
                badge.color.frame(width: 5)

                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.name)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(.primary)
                            .lineLimit(2)

                        HStack(spacing: 6) {
                            Text(timeStr).font(.system(size: 11)).foregroundColor(.secondary)
                            Text("·").foregroundColor(Color(uiColor: .tertiaryLabel))
                            Text(durStr).font(.system(size: 11, design: .monospaced)).foregroundColor(.secondary)
                            if entry.sportType == "Badminton" && !entry.hasDescription {
                                Circle().fill(Theme.attentionOrange).frame(width: 5, height: 5)
                            }
                        }
                    }

                    Spacer(minLength: 8)

                    VStack(alignment: .trailing, spacing: 2) {
                        // Watermark icon
                        Image(systemName: Theme.sportIcon(for: entry.sportType))
                            .font(.system(size: 28, weight: .semibold))
                            .foregroundColor(badge.color.opacity(0.2))

                        if let cal = entry.activity?.calories {
                            Text("\(cal)")
                                .font(.system(size: 20, weight: .bold, design: .monospaced))
                                .foregroundColor(.primary)
                            Text("CAL")
                                .font(.system(size: 8, weight: .bold)).kerning(1)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
            }

            // Zone bar: flush to card bottom, rounded by card clip
            CompactZoneBar(zones: entry.activity?.hrZones, height: 6, rounded: false)
        }
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(Theme.cardBorder, lineWidth: 1))
    }
}

// MARK: - ═══ VARIANT 3 — Sport-Tinted Activity Grid ═══
//
// Top: 3 raw bold numbers (no card, maximum visual weight)
// Body: 2-column grid of sport-colored cards — each card shows the sport
//       icon large, name, calories, and a compact zone bar at the bottom.
//       The card's background tint immediately identifies the sport at a glance.

struct FeedVariant3: View {
    let entries: [SyncCacheEntry]

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10)
    ]

    var body: some View {
        LazyVStack(spacing: 0) {
            GridStatBanner(entries: entries)
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 16)

            Divider().opacity(0.5)

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(entries) { entry in
                    NavigationLink(value: entry) {
                        ActivityGridCard(entry: entry)
                    }
                    .buttonStyle(CardPressButtonStyle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 16)
        }
    }
}

private struct GridStatBanner: View {
    let entries: [SyncCacheEntry]
    private var totalSecs: Int { entries.reduce(0) { $0 + $1.elapsedTime } }
    private var days: Int {
        let cal = Calendar.current
        return Set(entries.compactMap { e -> String? in
            guard let d = _inputFmt.date(from: e.startDateLocal) else { return nil }
            return _dayFmt.string(from: cal.startOfDay(for: d))
        }).count
    }
    private var timeStr: String {
        let h = totalSecs / 3600, m = (totalSecs % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        HStack(spacing: 0) {
            GridStat(value: "\(entries.count)", label: "THIS WEEK")
            GridStat(value: timeStr, label: "ACTIVE")
            GridStat(value: "\(days)", label: "DAYS")
        }
    }
}

private struct GridStat: View {
    let value: String; let label: String
    var body: some View {
        VStack(alignment: .center, spacing: 3) {
            Text(value)
                .font(.system(size: 28, weight: .black, design: .monospaced))
                .foregroundColor(.primary)
                .contentTransition(.numericText())
            Text(label)
                .font(.system(size: 8, weight: .bold)).kerning(1.5)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct ActivityGridCard: View {
    let entry: SyncCacheEntry
    private var badge: (label: String, color: Color) { Theme.sportBadge(for: entry.sportType) }
    private var timeStr: String {
        guard let d = _inputFmt.date(from: entry.startDateLocal) else { return "" }
        return d.formatted(date: .omitted, time: .shortened)
    }
    private var durStr: String {
        let h = entry.elapsedTime / 3600, m = (entry.elapsedTime % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                // Header row: sport label + icon
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(badge.label)
                            .font(.system(size: 8, weight: .bold)).kerning(1)
                            .foregroundColor(badge.color)
                        Text(timeStr)
                            .font(.system(size: 9)).foregroundColor(.secondary)
                    }
                    Spacer()
                    Image(systemName: Theme.sportIcon(for: entry.sportType))
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundColor(badge.color.opacity(0.35))
                }

                Spacer(minLength: 10)

                // Name + cal
                Text(entry.name)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(2)
                    .foregroundColor(.primary)
                    .fixedSize(horizontal: false, vertical: true)

                if let cal = entry.activity?.calories {
                    Text("\(cal) cal")
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(badge.color)
                        .padding(.top, 3)
                } else {
                    Text(durStr)
                        .font(.system(size: 13, weight: .bold, design: .monospaced))
                        .foregroundColor(.secondary)
                        .padding(.top, 3)
                }
            }
            .padding(12)

            // Zone bar at card bottom, clipped by card shape
            CompactZoneBar(zones: entry.activity?.hrZones, height: 4, rounded: false)
        }
        .frame(minHeight: 120, maxHeight: 140)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(badge.color.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius).stroke(badge.color.opacity(0.2), lineWidth: 1))
    }
}
