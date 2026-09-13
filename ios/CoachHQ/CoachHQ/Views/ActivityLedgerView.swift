import SwiftUI

struct ActivityLedgerView: View {
    let entries: [SyncCacheEntry]
    let onSelect: (SyncCacheEntry) -> Void
    var onBack: (() -> Void)? = nil
    var footer: AnyView? = nil
    var onRiffleChange: ((Bool) -> Void)? = nil

    @State private var openWeekIDs: Set<String> = []
    @State private var pulledID: String?
    @State private var riffledID: String?
    @State private var showingLoadSheet = false
    @State private var justRiffled = false

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
                    riffledID: riffledID,
                    onToggle: { toggle(week) },
                    onPull: { pull($0) },
                    onOpen: { open($0) },
                    onRiffleChanged: { id in
                        if riffledID != id {
                            riffledID = id
                            if id != nil {
                                LedgerHaptics.selection()
                            }
                        }
                    },
                    onRiffleArmed: { onRiffleChange?($0) },
                    consumeRiffleEnd: { id in
                        finishRiffle(id)
                    },
                    shouldIgnoreTap: { justRiffled }
                )
            }

            if let footer {
                footer
                    .padding(.top, 2)
            }

            Color.clear.frame(height: 8)
        }
        .padding(.horizontal, 16)
        // Mock's 64px includes the status-bar band inside the device frame.
        // ScrollView content already clears the safe area, so keep this tight.
        .padding(.top, 12)
        .padding(.bottom, 40)
        .onAppear(perform: seedInitialState)
        .onChange(of: entries.map(\.id)) { _, _ in seedInitialState() }
        .sheet(isPresented: $showingLoadSheet) {
            ActivityLedgerLoadSheet()
                .presentationDetents([.height(420)])
                .presentationDragIndicator(.hidden)
                .presentationCornerRadius(28)
                .presentationBackground(WarmInstrument.paper)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let onBack {
                Button {
                    LedgerHaptics.light()
                    onBack()
                } label: {
                    Text("‹ HQ")
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
                HStack(spacing: 6) {
                    Text("HOW IS LOAD COMPUTED?")
                    Text("›")
                        .font(.system(size: 12, weight: .bold))
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
        withAnimation(ActivityLedgerMetrics.weekMotion) {
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
            open(item.entry)
            return
        }

        withAnimation(ActivityLedgerMetrics.cardMotion) {
            pulledID = item.id
        }
        LedgerHaptics.light()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            LedgerHaptics.soft()
        }
    }

    private func open(_ entry: SyncCacheEntry) {
        LedgerHaptics.medium()
        onSelect(entry)
    }

    private func finishRiffle(_ id: String?) {
        justRiffled = true
        onRiffleChange?(false)
        if let id, let item = weeks.flatMap(\.items).first(where: { $0.id == id }), pulledID != id {
            pull(item)
        }
        riffledID = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            justRiffled = false
        }
    }
}

private struct ActivityLedgerWeekView: View {
    let week: ActivityLedgerWeek
    let isOpen: Bool
    let pulledID: String?
    let riffledID: String?
    let onToggle: () -> Void
    let onPull: (ActivityLedgerItem) -> Void
    let onOpen: (SyncCacheEntry) -> Void
    let onRiffleChanged: (String?) -> Void
    let onRiffleArmed: (Bool) -> Void
    let consumeRiffleEnd: (String?) -> Void
    let shouldIgnoreTap: () -> Bool

    @State private var holdTask: Task<Void, Never>?
    @State private var riffleArmed = false

    private var stackSpace: String { "ledger-stack-\(week.id)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: onToggle) {
                weekHeader
            }
            .buttonStyle(.plain)

            weekBody
        }
    }

    private var weekHeader: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("WK \(week.weekNumber)")
                    .font(WarmInstrument.monoLabel(10, weight: .bold))
                    .tracking(1.3)
                    .foregroundColor(WarmInstrument.ink)
                Text(week.rangeLabel)
                    .font(WarmInstrument.monoLabel(9, weight: .regular))
                    .tracking(0.8)
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
                    .foregroundColor(LedgerPaper.verdict)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .rotationEffect(.degrees(isOpen ? 0 : -90))
                    .padding(.leading, 2)
            }
        }
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
    }

    private var weekBody: some View {
        Group {
            if isOpen {
                openStack
            } else if let newest = week.items.first {
                Button(action: onToggle) {
                    ActivityLedgerClosedStack(
                        item: newest,
                        hiddenCount: max(0, week.items.count - 1)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .padding(.bottom, ActivityLedgerMetrics.shadowBleed)
        .frame(height: bodyHeight + ActivityLedgerMetrics.shadowBleed, alignment: .top)
        .clipped()
        .padding(.bottom, -ActivityLedgerMetrics.shadowBleed)
    }

    private var bodyHeight: CGFloat {
        isOpen
            ? week.openBodyHeight(pulledID: pulledID)
            : ActivityLedgerMetrics.closedHeight
    }

    private var openStack: some View {
        VStack(spacing: 0) {
            ForEach(Array(week.items.enumerated()), id: \.element.id) { index, item in
                let isPulled = pulledID == item.id
                let height = cardHeight(index: index, isPulled: isPulled)
                ActivityLedgerCard(
                    item: item,
                    isPulled: isPulled,
                    visibleHeight: height,
                    isRiffled: riffledID == item.id && !isPulled
                )
                .padding(.top, topMargin(index: index, isPulled: isPulled))
                .zIndex(Double(week.items.count - index))
                .contentShape(Rectangle())
                .onTapGesture {
                    guard !shouldIgnoreTap() else { return }
                    if isPulled {
                        onOpen(item.entry)
                    } else {
                        onPull(item)
                    }
                }
            }
        }
        .padding(.top, 2)
        .coordinateSpace(.named(stackSpace))
        .simultaneousGesture(riffleGesture)
    }

    private var riffleGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(stackSpace))
            .onChanged { value in
                if holdTask == nil && !riffleArmed {
                    let startY = value.startLocation.y
                    holdTask = Task {
                        try? await Task.sleep(for: .milliseconds(180))
                        guard !Task.isCancelled else { return }
                        await MainActor.run {
                            riffleArmed = true
                            onRiffleArmed(true)
                            onRiffleChanged(week.cardID(at: startY, pulledID: pulledID))
                        }
                    }
                }

                let travel = hypot(value.translation.width, value.translation.height)
                if !riffleArmed, travel > 12 {
                    holdTask?.cancel()
                    holdTask = nil
                    return
                }

                guard riffleArmed else { return }
                onRiffleChanged(week.cardID(at: value.location.y, pulledID: pulledID))
            }
            .onEnded { _ in
                holdTask?.cancel()
                holdTask = nil
                let armed = riffleArmed
                riffleArmed = false
                onRiffleArmed(false)
                if armed {
                    consumeRiffleEnd(riffledID)
                } else {
                    onRiffleChanged(nil)
                }
            }
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

/// One paper slip. Card 0 collapses by shrinking the stats strip to 0 —
/// clipping a full-height child was leaking labels above the row.
private struct ActivityLedgerCard: View {
    let item: ActivityLedgerItem
    let isPulled: Bool
    let visibleHeight: CGFloat
    var isRiffled = false

    private var statsHeight: CGFloat {
        max(0, visibleHeight - ActivityLedgerMetrics.peek)
    }

    var body: some View {
        VStack(spacing: 0) {
            statsStrip
                .frame(height: ActivityLedgerMetrics.peek, alignment: .bottom)
                .frame(height: statsHeight, alignment: .bottom)
                .clipped()
                .opacity(statsHeight < 1 ? 0 : 1)

            row
        }
        .frame(maxWidth: .infinity)
        .frame(height: visibleHeight, alignment: .bottom)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(LedgerPaper.border, lineWidth: 1)
        )
        .compositingGroup()
        .shadow(
            color: LedgerPaper.shadow.opacity(isPulled ? 0.20 : isRiffled ? 0.16 : 0.08),
            radius: isPulled ? 14 : isRiffled ? 10 : 6,
            x: 0,
            y: isPulled ? 12 : isRiffled ? 8 : 4
        )
        .scaleEffect(isPulled ? 1.012 : 1)
        .offset(y: isRiffled ? -5 : 0)
        .animation(ActivityLedgerMetrics.cardMotion, value: isPulled)
        .animation(ActivityLedgerMetrics.cardMotion, value: visibleHeight)
        .animation(ActivityLedgerMetrics.riffleMotion, value: isRiffled)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var row: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(item.sportColor)
                .frame(width: 3, height: 30)

            Image(systemName: item.sportIcon)
                .font(.system(size: 20, weight: .regular))
                .foregroundColor(LedgerPaper.glyph)
                .frame(width: 20, height: 20)

            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.system(size: 15, weight: .semibold))
                    .tracking(-0.15)
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)

                metaLine
            }

            Spacer(minLength: 8)

            Text(item.loadLabel)
                .font(WarmInstrument.figures(17, weight: .bold))
                .tracking(-0.5)
                .foregroundColor(WarmInstrument.ink)
                .contentTransition(.numericText())
        }
        .frame(height: ActivityLedgerMetrics.peek)
        .padding(.horizontal, 18)
    }

    private var metaLine: some View {
        HStack(spacing: 0) {
            Text(item.dayLabel)
                .foregroundColor(item.isToday ? WarmInstrument.accent : WarmInstrument.inkMuted)
                .fontWeight(item.isToday ? .bold : .regular)
            Text(" · \(item.timeLabel) · \(item.durationLabel)")
                .foregroundColor(WarmInstrument.inkMuted)
        }
        .font(WarmInstrument.monoLabel(9.5, weight: .regular))
        .tracking(0.48)
        .lineLimit(1)
    }

    private var statsStrip: some View {
        HStack(spacing: 10) {
            ForEach(item.stats) { stat in
                VStack(alignment: .leading, spacing: 5) {
                    Text(stat.value)
                        .font(WarmInstrument.figures(15, weight: .bold))
                        .tracking(-0.45)
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text(stat.label)
                        .font(WarmInstrument.monoLabel(8, weight: .bold))
                        .tracking(1.04)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: ActivityLedgerMetrics.peek)
        .padding(.horizontal, 18)
    }
}

private struct ActivityLedgerClosedStack: View {
    let item: ActivityLedgerItem
    let hiddenCount: Int

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(item.sportColor)
                    .frame(width: 3, height: 30)

                Image(systemName: item.sportIcon)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundColor(LedgerPaper.glyph)
                    .frame(width: 20, height: 20)

                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(.system(size: 15, weight: .semibold))
                        .tracking(-0.15)
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(1)

                    Text(item.metaLine)
                        .font(WarmInstrument.monoLabel(9.5, weight: .regular))
                        .tracking(0.48)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if hiddenCount > 0 {
                    Text("+\(hiddenCount) MORE")
                        .font(WarmInstrument.monoLabel(8.5, weight: .bold))
                        .tracking(1.0)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .strokeBorder(WarmInstrument.headerRule, lineWidth: 1)
                        )
                } else {
                    Text(item.loadLabel)
                        .font(WarmInstrument.figures(17, weight: .bold))
                        .tracking(-0.5)
                        .foregroundColor(WarmInstrument.ink)
                }
            }
            .frame(height: ActivityLedgerMetrics.peek)
            .padding(.horizontal, 18)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(LedgerPaper.border, lineWidth: 1)
            )
            .shadow(color: LedgerPaper.shadow.opacity(0.12), radius: 9, x: 0, y: 8)
            .zIndex(2)

            if hiddenCount > 0 {
                stackEdge(inset: 10, fill: LedgerPaper.edgeFront, shadowed: true)
                if hiddenCount > 1 {
                    stackEdge(inset: 20, fill: LedgerPaper.edgeBack, shadowed: false)
                }
            }
        }
    }

    private func stackEdge(inset: CGFloat, fill: Color, shadowed: Bool) -> some View {
        UnevenRoundedRectangle(
            topLeadingRadius: 0,
            bottomLeadingRadius: 14,
            bottomTrailingRadius: 14,
            topTrailingRadius: 0,
            style: .continuous
        )
        .fill(fill)
        .overlay(alignment: .bottom) {
            UnevenRoundedRectangle(
                topLeadingRadius: 0,
                bottomLeadingRadius: 14,
                bottomTrailingRadius: 14,
                topTrailingRadius: 0,
                style: .continuous
            )
            .strokeBorder(LedgerPaper.border.opacity(shadowed ? 1 : 0.9), lineWidth: 1)
        }
        .frame(height: 9)
        .padding(.horizontal, inset)
        .shadow(
            color: shadowed ? LedgerPaper.shadow.opacity(0.08) : .clear,
            radius: 5,
            x: 0,
            y: 4
        )
        .offset(y: -1)
    }
}

private struct ActivityLedgerLoadSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Capsule()
                .fill(WarmInstrument.headerRule)
                .frame(width: 36, height: 4)
                .frame(maxWidth: .infinity)

            HStack(alignment: .firstTextBaseline) {
                Text("How load is computed")
                    .font(.system(size: 22, weight: .semibold))
                    .tracking(-0.44)
                    .foregroundColor(WarmInstrument.ink)
                Spacer(minLength: 12)
                Button("CLOSE") {
                    LedgerHaptics.light()
                    dismiss()
                }
                .font(WarmInstrument.monoLabel(10, weight: .bold))
                .tracking(1.2)
                .foregroundColor(WarmInstrument.inkMuted)
            }

            Text("LOAD = Σ ( MINUTES × ZONE WEIGHT )")
                .font(WarmInstrument.monoLabel(13, weight: .bold))
                .tracking(0.26)
                .foregroundColor(WarmInstrument.accent)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(WarmInstrument.accent.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(WarmInstrument.accent.opacity(0.3), lineWidth: 1)
                )

            Text("Every minute of a session is weighted by the heart-rate zone you spent it in, then summed. A hard hour scores more than an easy one; a long easy ride can still outscore a short sprint. The same rule applies to every sport, so a badminton night and a lift are comparable.")
                .font(WarmInstrument.coachVoice(16))
                .foregroundColor(LedgerPaper.glyph)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                ForEach(ActivityLedgerMetrics.zoneWeights.indices, id: \.self) { index in
                    let zone = Theme.hrZoneColors[index]
                    VStack(spacing: 6) {
                        Text("Z\(index + 1)")
                            .font(WarmInstrument.monoLabel(8, weight: .bold))
                            .tracking(1.0)
                            .foregroundColor(WarmInstrument.inkMuted)
                        Text("×\(ActivityLedgerMetrics.zoneWeights[index])")
                            .font(WarmInstrument.figures(15, weight: .bold))
                            .tracking(-0.45)
                            .foregroundColor(WarmInstrument.ink)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(zone.opacity(index >= 3 ? 0.22 : 0.28))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }

            Text("WEEKLY BAND = YOUR 8-WEEK RHYTHM ±20%")
                .font(WarmInstrument.monoLabel(9, weight: .bold))
                .tracking(1.0)
                .foregroundColor(WarmInstrument.inkFaintText)
        }
        .padding(.horizontal, 24)
        .padding(.top, 14)
        .padding(.bottom, 28)
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

    func openBodyHeight(pulledID: String?) -> CGFloat {
        var height: CGFloat = 2
        for (index, item) in items.enumerated() {
            let isPulled = pulledID == item.id
            height += index == 0
                ? (isPulled ? ActivityLedgerMetrics.cardHeight : ActivityLedgerMetrics.peek)
                : ActivityLedgerMetrics.cardHeight
            if index > 0 {
                height += isPulled ? ActivityLedgerMetrics.pullGap : -ActivityLedgerMetrics.peek
            }
        }
        return height
    }

    func cardID(at y: CGFloat, pulledID: String?) -> String? {
        var cursor: CGFloat = 2
        var frames: [(id: String, range: ClosedRange<CGFloat>)] = []
        for (index, item) in items.enumerated() {
            let isPulled = pulledID == item.id
            let height = index == 0
                ? (isPulled ? ActivityLedgerMetrics.cardHeight : ActivityLedgerMetrics.peek)
                : ActivityLedgerMetrics.cardHeight
            let margin = index == 0 ? 0 : (isPulled ? ActivityLedgerMetrics.pullGap : -ActivityLedgerMetrics.peek)
            cursor += margin
            frames.append((item.id, cursor...(cursor + height)))
            cursor += height
        }
        return frames.first(where: { $0.range.contains(y) })?.id
    }

    @MainActor
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

    private static let monthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM"
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

        let startDay = calendar.component(.day, from: start)
        let endDay = calendar.component(.day, from: end)
        let startMonth = monthFormatter.string(from: start).uppercased()
        let endMonth = monthFormatter.string(from: end).uppercased()
        if startMonth == endMonth {
            return "\(startDay)–\(endDay) \(endMonth)"
        }
        return "\(startDay) \(startMonth) – \(endDay) \(endMonth)"
    }
}

/// H = 2·PEEK so a tucked card always lands at −PEEK and only its row shows.
private enum ActivityLedgerMetrics {
    static let peek: CGFloat = 64
    static let cardHeight: CGFloat = 128
    static let pullGap: CGFloat = 12
    static let closedHeight: CGFloat = 84
    static let shadowBleed: CGFloat = 30
    static let zoneWeights = [1, 2, 3, 4, 5]
    static let cardMotion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.42)
    static let weekMotion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.46).delay(0.06)
    static let riffleMotion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.22)
}

private enum LedgerPaper {
    static let border = Color(uiColor: UIColor { trait in
        UIColor(red: 84 / 255, green: 76 / 255, blue: 65 / 255, alpha: trait.userInterfaceStyle == .dark ? 0.35 : 0.18)
    })
    static let glyph = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0xed / 255, green: 0xea / 255, blue: 0xe2 / 255, alpha: 1)
            : UIColor(red: 0x4a / 255, green: 0x4c / 255, blue: 0x46 / 255, alpha: 1)
    })
    static let verdict = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x9e / 255, green: 0x9c / 255, blue: 0x93 / 255, alpha: 1)
            : UIColor(red: 0x6e / 255, green: 0x70 / 255, blue: 0x68 / 255, alpha: 1)
    })
    static let shadow = Color(red: 57 / 255, green: 52 / 255, blue: 42 / 255)
    static let edgeFront = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x1c / 255, green: 0x1b / 255, blue: 0x17 / 255, alpha: 1)
            : UIColor(red: 0xf6 / 255, green: 0xf2 / 255, blue: 0xe9 / 255, alpha: 1)
    })
    static let edgeBack = Color(uiColor: UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x18 / 255, green: 0x17 / 255, blue: 0x14 / 255, alpha: 1)
            : UIColor(red: 0xf1 / 255, green: 0xec / 255, blue: 0xe2 / 255, alpha: 1)
    })
}

private enum LedgerHaptics {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    static func soft() {
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    }

    static func rigid() {
        UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
    }

    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
