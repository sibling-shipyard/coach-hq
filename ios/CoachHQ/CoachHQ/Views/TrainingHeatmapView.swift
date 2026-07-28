import SwiftUI

/// Month-grid heatmap of training activity for the last 8 weeks (56 days).
/// Rendered as M–S columns × week rows, each cell colored by the sport type
/// of the activity logged that day (or muted if none). Tapping a filled cell
/// shows that day's activities in a bottom sheet.
///
/// Data source: SyncCache (up to 30 days). Older cells show as empty until
/// a future GitHub backfill populates them.
struct TrainingHeatmapView: View {
    let entries: [SyncCacheEntry]

    @State private var selectedDay: String? = nil

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current; return f
    }()
    private static let inputFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"; f.timeZone = .current; return f
    }()

    // MARK: - Grid model

    struct HeatCell: Identifiable {
        let id: String         // YYYY-MM-DD
        let col: Int           // 0=Mon … 6=Sun
        let row: Int           // 0 = oldest week
        let activities: [SyncCacheEntry]
        let isFuture: Bool

        var isEmpty: Bool { activities.isEmpty }

        var color: Color {
            guard let first = activities.first else { return .clear }
            return Theme.sportBadge(for: first.sportType).color
        }
    }

    /// 8-week grid (56 days), oldest week first, Mon–Sun columns.
    private var grid: [[HeatCell?]] {
        let cal = Calendar.current
        let today = Date()
        let todayStart = cal.startOfDay(for: today)

        // Anchor to Monday of the current week
        let daysSinceMonday = (cal.component(.weekday, from: today) + 5) % 7
        guard let thisMonday = cal.date(byAdding: .day, value: -daysSinceMonday, to: todayStart) else { return [] }

        // Start 7 weeks back (oldest Monday)
        guard let startMonday = cal.date(byAdding: .weekOfYear, value: -7, to: thisMonday) else { return [] }

        // Map YYYY-MM-DD → entries
        let entryMap: [String: [SyncCacheEntry]] = Dictionary(
            grouping: entries,
            by: { entry -> String in
                guard let d = Self.inputFormatter.date(from: entry.startDateLocal) else { return "" }
                return Self.dayFormatter.string(from: d)
            }
        ).filter { !$0.key.isEmpty }

        var rows: [[HeatCell?]] = []
        for week in 0..<8 {
            var row: [HeatCell?] = []
            for day in 0..<7 {
                guard let date = cal.date(
                    byAdding: .day,
                    value: week * 7 + day,
                    to: startMonday
                ) else { row.append(nil); continue }

                let dateStr = Self.dayFormatter.string(from: date)
                let isFuture = date > todayStart
                row.append(HeatCell(
                    id: dateStr,
                    col: day,
                    row: week,
                    activities: isFuture ? [] : (entryMap[dateStr] ?? []),
                    isFuture: isFuture
                ))
            }
            rows.append(row)
        }
        return rows
    }

    private var selectedActivities: [SyncCacheEntry] {
        guard let day = selectedDay else { return [] }
        return grid.flatMap { $0 }.compactMap { $0 }.filter { $0.id == day }.first?.activities ?? []
    }

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("8 Weeks")

            ThemedCard(padding: 10) {
                VStack(alignment: .leading, spacing: 5) {
                    dayHeaders
                    ForEach(grid.indices, id: \.self) { rowIdx in
                        let row = grid[rowIdx]
                        HStack(spacing: 4) {
                            ForEach(0..<7, id: \.self) { col in
                                if col < row.count, let cell = row[col] {
                                    cellView(cell)
                                } else {
                                    Color.clear.frame(maxWidth: .infinity).frame(height: 12)
                                }
                            }
                        }
                    }
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { selectedDay != nil },
            set: { if !$0 { selectedDay = nil } }
        )) {
            DayDetailSheet(date: selectedDay ?? "", activities: selectedActivities)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        // Dismiss any open day sheet when entries refresh — avoids showing a stale/empty sheet
        // if the selected day fell out of the refreshed cache window.
        .onChange(of: entries.count) { _, _ in selectedDay = nil }
    }

    private var dayHeaders: some View {
        HStack(spacing: 4) {
            ForEach(["M", "T", "W", "T", "F", "S", "S"], id: \.self) { label in
                Text(label)
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    @ViewBuilder
    private func cellView(_ cell: HeatCell) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(cellFill(cell))
            .frame(maxWidth: .infinity)
            .frame(height: 12)
            .onTapGesture {
                guard !cell.isEmpty && !cell.isFuture else { return }
                Haptics.tap()
                selectedDay = cell.id
            }
    }

    private func cellFill(_ cell: HeatCell) -> Color {
        if cell.isFuture         { return Theme.mutedBackground.opacity(0.4) }
        if cell.isEmpty          { return Theme.mutedBackground }
        return cell.color.opacity(0.85)
    }
}

// MARK: - Day detail sheet

private struct DayDetailSheet: View {
    let date: String
    let activities: [SyncCacheEntry]

    private static let inputFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"; f.timeZone = .current; return f
    }()

    private var formattedDate: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
        guard let d = f.date(from: date) else { return date }
        return d.formatted(.dateTime.weekday(.wide).day().month(.wide).year())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(formattedDate)
                    .font(.system(size: 15, weight: .semibold))
                Text("\(activities.count) activit\(activities.count == 1 ? "y" : "ies")")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 12)

            Divider()

            ScrollView {
                VStack(spacing: 0) {
                    ForEach(activities) { entry in
                        HStack(spacing: 10) {
                            Theme.sportBadge(for: entry.sportType).color.frame(width: 3)

                            VStack(alignment: .leading, spacing: 2) {
                                SportBadge(sportType: entry.sportType)
                                Text(entry.name)
                                    .font(.system(size: 13, weight: .semibold))
                                    .lineLimit(1)
                                let mins = entry.elapsedTime / 60
                                Text(mins >= 60
                                     ? "\(mins/60)h \(mins%60)m"
                                     : "\(mins)m")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.secondary)
                            }
                            .padding(.vertical, 10)

                            Spacer()
                        }

                        if entry.id != activities.last?.id {
                            Divider().padding(.leading, 13)
                        }
                    }
                }
                .background(Theme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.cornerRadius)
                        .stroke(Theme.cardBorder, lineWidth: 1)
                )
                .padding(16)
            }
        }
        .background(Color(uiColor: .systemBackground))
    }
}

