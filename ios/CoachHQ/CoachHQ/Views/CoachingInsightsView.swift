import SwiftUI

// DEPRECATED: superseded by `WarmInstrumentHomeView` (see `AGENTS.md` → Warm Instrument Home,
// `kdb/decisions/0005-widget-snapshots-cross-platform.md`). No longer reachable from
// `MainTabView`. Left in place for reference only — do not add new widgets here.

// MARK: - Date helpers

private let _isoFmt: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    f.timeZone = .current
    return f
}()

private let _dayFmt2: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = .current
    return f
}()

private func entryDate(_ e: SyncCacheEntry) -> Date? {
    _isoFmt.date(from: e.startDateLocal)
}

private func startOfToday() -> Date {
    Calendar.current.startOfDay(for: Date())
}

private func daysBack(_ n: Int) -> Date {
    Calendar.current.date(byAdding: .day, value: -n, to: startOfToday())!
}

// MARK: - Staggered appear modifier (#6)

private struct AppearModifier: ViewModifier {
    let delay: Double
    @State private var visible = false

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : 18)
            .onAppear {
                withAnimation(.spring(duration: 0.4, bounce: 0.15).delay(delay)) {
                    visible = true
                }
            }
    }
}

private extension View {
    func appearEffect(delay: Double = 0) -> some View {
        modifier(AppearModifier(delay: delay))
    }
}

// MARK: - CoachingInsightsView

struct CoachingInsightsView: View {
    @State private var entries: [SyncCacheEntry] = []
    @State private var isLoading = true  // #3 skeleton flag

    var body: some View {
        VStack(spacing: 0) {
            BrandHeader(title: "Insights")
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Each VStack groups header + card so they cascade as one unit (#6)
                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeader("Training Load")
                        TrainingLoadWidget(entries: entries)
                            .skeleton(isLoading)
                    }
                    .appearEffect(delay: 0.05)

                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeader("Zone Distribution")
                        ZoneRingWidget(entries: entries)
                            .skeleton(isLoading)
                    }
                    .padding(.top, 4)
                    .appearEffect(delay: 0.10)

                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeader("Consistency")
                        StreakWidget(entries: entries)
                            .skeleton(isLoading)
                    }
                    .padding(.top, 4)
                    .appearEffect(delay: 0.15)

                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeader("Sport Balance")
                        SportBalanceWidget(entries: entries)
                            .skeleton(isLoading)
                    }
                    .padding(.top, 4)
                    .appearEffect(delay: 0.20)

                    VStack(alignment: .leading, spacing: 6) {
                        SectionHeader("8-Week Heatmap")
                        TrainingHeatmapView(entries: entries)
                    }
                    .padding(.top, 4)
                    .appearEffect(delay: 0.30)
                }
                .padding(16)
            }
            .refreshable { entries = SyncCache.load() }  // #4 pull-to-refresh
        }
        .task {
            entries = SyncCache.load()
            withAnimation { isLoading = false }
        }
    }
}

// MARK: - Training Load Widget

struct TrainingLoadWidget: View {
    let entries: [SyncCacheEntry]

    private var thisWeek: [SyncCacheEntry] {
        entries.filter { entryDate($0).map { $0 >= daysBack(7) } ?? false }
    }
    private var lastWeek: [SyncCacheEntry] {
        entries.filter { entryDate($0).map { $0 >= daysBack(14) && $0 < daysBack(7) } ?? false }
    }

    private var thisCal: Int  { thisWeek.compactMap(\.calories).reduce(0, +) }
    private var lastCal: Int  { lastWeek.compactMap(\.calories).reduce(0, +) }
    private var thisTime: Int { thisWeek.map(\.elapsedTime).reduce(0, +) }
    private var lastTime: Int { lastWeek.map(\.elapsedTime).reduce(0, +) }

    private var calDelta: Int  { thisCal - lastCal }
    private var timeDelta: Int { thisTime - lastTime }

    private func formattedHours(_ secs: Int) -> String {
        let h = secs / 3600
        let m = (secs % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    var body: some View {
        ThemedCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 0) {
                    loadColumn(title: "THIS WEEK", sessions: thisWeek.count,
                               cal: thisCal, time: thisTime)
                    Spacer()
                    Divider().frame(height: 50)
                    Spacer()
                    loadColumn(title: "LAST WEEK", sessions: lastWeek.count,
                               cal: lastCal, time: lastTime)
                }

                Divider()

                HStack(spacing: 20) {
                    deltaChip(value: calDelta, suffix: " kcal", icon: "flame.fill")
                    deltaChip(value: timeDelta / 60, suffix: " min", icon: "clock.fill")
                }
            }
        }
    }

    private func loadColumn(title: String, sessions: Int, cal: Int, time: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 9, weight: .bold))
                .kerning(1.2)
                .foregroundColor(.secondary)
            Text("\(sessions) sessions")
                .font(.system(size: 22, weight: .black))
                .foregroundColor(.primary)
                .contentTransition(.numericText())  // #5
            Text(cal > 0 ? "\(cal) kcal · \(formattedHours(time))" : formattedHours(time))
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .contentTransition(.numericText())
        }
    }

    private func deltaChip(value: Int, suffix: String, icon: String) -> some View {
        let positive = value >= 0
        let color: Color = positive ? Theme.accentGreen : WarmInstrument.alarmFg
        return HStack(spacing: 4) {
            Image(systemName: positive ? "arrow.up.right" : "arrow.down.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(color)
            Text("\(positive ? "+" : "")\(value)\(suffix)")
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                .foregroundColor(color)
                .contentTransition(.numericText())  // #5
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Zone Ring Widget

struct ZoneRingWidget: View {
    let entries: [SyncCacheEntry]

    @State private var animatedFraction: Double = 0  // #1 animated ring

    private var thisWeek: [SyncCacheEntry] {
        entries.filter { entryDate($0).map { $0 >= daysBack(7) } ?? false }
    }

    private var zoneTotals: [Double] {
        return HRZone.keys.map { key in
            thisWeek.compactMap { $0.activity?.hrZones?[key]?.seconds }.reduce(0, +)
        }
    }

    private var totalZoneTime: Double { zoneTotals.reduce(0, +) }
    private var aerobicSecs: Double   { zoneTotals[0] + zoneTotals[1] }
    private var intensitySecs: Double { zoneTotals[2] + zoneTotals[3] + zoneTotals[4] }

    private var aerobicFraction: Double {
        guard totalZoneTime > 0 else { return 0 }
        return aerobicSecs / totalZoneTime
    }

    private func fmt(_ secs: Double) -> String {
        let m = Int(secs) / 60
        return m >= 60 ? "\(m / 60)h \(m % 60)m" : "\(m)m"
    }

    var body: some View {
        ThemedCard {
            HStack(alignment: .center, spacing: 20) {
                ZStack {
                    Circle()
                        .stroke(Theme.cardBorder, lineWidth: 14)
                        .frame(width: 90, height: 90)

                    if totalZoneTime > 0 {
                        // Aerobic arc (Z1+Z2)
                        Circle()
                            .trim(from: 0, to: animatedFraction)
                            .stroke(Theme.hrZoneColors[1],
                                    style: StrokeStyle(lineWidth: 14, lineCap: .butt))
                            .rotationEffect(.degrees(-90))
                            .frame(width: 90, height: 90)

                        // Intensity arc (Z3–Z5): always trim to 1.0; the if totalZoneTime>0
                        // guard above already hides arcs when there's no data, so no ternary needed.
                        Circle()
                            .trim(from: animatedFraction, to: 1.0)
                            .stroke(Theme.hrZoneColors[3],
                                    style: StrokeStyle(lineWidth: 14, lineCap: .butt))
                            .rotationEffect(.degrees(-90))
                            .frame(width: 90, height: 90)

                        VStack(spacing: 1) {
                            Text("\(Int(animatedFraction * 100))%")
                                .font(.system(size: 16, weight: .black).monospacedDigit())
                                .contentTransition(.numericText())  // #5
                            Text("base")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(.secondary)
                        }
                    } else {
                        Text("No HR")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    zoneRow(label: "Aerobic  Z1+Z2", secs: aerobicSecs,
                            color: Theme.hrZoneColors[1])
                    zoneRow(label: "Intensity Z3–Z5", secs: intensitySecs,
                            color: Theme.hrZoneColors[3])
                    if totalZoneTime == 0 {
                        Text("Sync activities with HR data to see zone breakdown")
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)
                    }
                }
                Spacer()
            }
        }
        // #1: onAppear fires before entries load so it's a no-op; onChange is the
        // reliable trigger — it fires whenever aerobicFraction changes after data arrives.
        .onChange(of: aerobicFraction) { _, new in
            withAnimation(.spring(duration: 0.5, bounce: 0.2)) {
                animatedFraction = new
            }
        }
    }

    private func zoneRow(label: String, secs: Double, color: Color) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 10, height: 10)
            Text(label)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
            Spacer()
            Text(secs > 0 ? fmt(secs) : "—")
                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                .contentTransition(.numericText())
        }
    }
}

// MARK: - Streak Widget

struct StreakWidget: View {
    let entries: [SyncCacheEntry]

    private var activeDays: Set<String> {
        Set(entries.compactMap { e -> String? in
            guard let d = entryDate(e) else { return nil }
            return _dayFmt2.string(from: d)
        })
    }

    private var currentStreak: Int {
        let cal = Calendar.current
        var count = 0
        var day = startOfToday()
        if !activeDays.contains(_dayFmt2.string(from: day)) {
            day = cal.date(byAdding: .day, value: -1, to: day)!
        }
        while activeDays.contains(_dayFmt2.string(from: day)) {
            count += 1
            day = cal.date(byAdding: .day, value: -1, to: day)!
        }
        return count
    }

    private var longestStreakThisMonth: Int {
        let cal = Calendar.current
        let now = Date()
        let comps = cal.dateComponents([.year, .month], from: now)
        guard let monthStart = cal.date(from: comps),
              let monthEnd = cal.date(byAdding: .month, value: 1, to: monthStart) else { return 0 }
        var best = 0, run = 0
        var day = monthStart
        while day < min(monthEnd, now) {
            if activeDays.contains(_dayFmt2.string(from: day)) {
                run += 1; best = max(best, run)
            } else { run = 0 }
            day = cal.date(byAdding: .day, value: 1, to: day)!
        }
        return best
    }

    // Returns days since last rest, or -1 if no rest day found in the 30-day window.
    private var lastRestDay: Int {
        let cal = Calendar.current
        var day = startOfToday()
        var back = 0
        while back < 30 {
            if !activeDays.contains(_dayFmt2.string(from: day)) { return back }
            back += 1
            day = cal.date(byAdding: .day, value: -1, to: day)!
        }
        return -1  // no rest found in window — don't claim "30d ago" as a fact
    }

    var body: some View {
        ThemedCard {
            HStack(spacing: 0) {
                streakStat(value: "\(currentStreak)",
                           label: "CURRENT STREAK",
                           sub: currentStreak == 1 ? "day" : "days",
                           color: currentStreak >= 3 ? Theme.accentGreen : .primary)
                Spacer()
                Divider().frame(height: 50)
                Spacer()
                streakStat(value: "\(longestStreakThisMonth)",
                           label: "BEST THIS MONTH",
                           sub: "days",
                           color: .primary)
                Spacer()
                Divider().frame(height: 50)
                Spacer()
                streakStat(value: lastRestDay < 0 ? "30d+" : lastRestDay == 0 ? "today" : "\(lastRestDay)d ago",
                           label: "LAST REST",
                           sub: "",
                           color: lastRestDay == 0 ? Theme.accentGreen : .secondary)
            }
        }
    }

    private func streakStat(value: String, label: String, sub: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .kerning(1)
                .foregroundColor(.secondary)
            Text(value)
                .font(.system(size: 22, weight: .black).monospacedDigit())
                .foregroundColor(color)
                .contentTransition(.numericText())  // #5
            if !sub.isEmpty {
                Text(sub)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
        }
    }
}

// MARK: - Sport Balance Widget

struct SportBalanceWidget: View {
    let entries: [SyncCacheEntry]

    @State private var barsVisible = false  // #2 bar entrance animation

    private struct SportSlice: Identifiable {
        let id: String
        let label: String
        let color: Color
        let sessions: Int
        let fraction: Double
    }

    private var slices: [SportSlice] {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month], from: Date())
        guard let monthStart = cal.date(from: comps) else { return [] }
        let thisMonth = entries.filter { entryDate($0).map { $0 >= monthStart } ?? false }
        guard !thisMonth.isEmpty else { return [] }
        let grouped = Dictionary(grouping: thisMonth, by: \.sportType)
        let total = Double(thisMonth.count)
        return grouped
            .map { sport, es in
                let badge = Theme.sportBadge(for: sport)
                return SportSlice(id: sport, label: badge.label, color: badge.color,
                                  sessions: es.count, fraction: Double(es.count) / total)
            }
            .sorted { $0.sessions > $1.sessions }
    }

    var body: some View {
        ThemedCard {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(slices.enumerated()), id: \.element.id) { index, slice in
                    sportRow(slice: slice, index: index)
                }
                if slices.isEmpty {
                    Text("No activities this month")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }
            }
        }
        .onAppear {
            withAnimation(.spring(duration: 0.5, bounce: 0.15).delay(0.15)) {
                barsVisible = true
            }
        }
        // Re-animate bars when entries refresh so new/changed sport rows animate in (#5)
        .onChange(of: entries.count) { _, _ in
            barsVisible = false
            withAnimation(.spring(duration: 0.5, bounce: 0.15).delay(0.1)) {
                barsVisible = true
            }
        }
    }

    private func sportRow(slice: SportSlice, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(slice.label)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(slice.color)
                Spacer()
                Text("\(slice.sessions) sessions")
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .foregroundColor(.secondary)
                Text("\(Int(slice.fraction * 100))%")
                    .font(.system(size: 11, weight: .bold).monospacedDigit())
                    .frame(width: 34, alignment: .trailing)
                    .contentTransition(.numericText())  // #5
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(slice.color.opacity(0.12))
                        .frame(height: 6)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(slice.color)
                        // #2: width animates from 0, staggered per sport row
                        .frame(width: geo.size.width * (barsVisible ? slice.fraction : 0), height: 6)
                        .animation(
                            .spring(duration: 0.5, bounce: 0.15)
                                .delay(Double(index) * 0.08),
                            value: barsVisible
                        )
                }
            }
            .frame(height: 6)
        }
    }
}
