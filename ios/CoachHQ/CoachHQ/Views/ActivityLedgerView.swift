import SwiftUI

enum ActivityLedgerStyle {
    /// All Activity page: back link, title, load sheet, week headers.
    case page
    /// Chat SESSION SYNCED slot: paper stack only, weeks forced open.
    case embed
}

struct ActivityLedgerView<Footer: View>: View {
    let entries: [SyncCacheEntry]
    let onSelect: (SyncCacheEntry) -> Void
    var onBack: (() -> Void)? = nil
    var style: ActivityLedgerStyle = .page
    /// Fallback load when `hrZones` are missing (provisional chat rows).
    var listedLoads: [String: Int] = [:]
    @ViewBuilder var footer: () -> Footer

    @State private var openWeekIDs: Set<String> = []
    @State private var pulledID: String?
    @State private var riffleID: String?
    @State private var pressID: String?
    @State private var riffleStore = LedgerRiffleFrameStore()
    @State private var ignoreCardTapUntil: TimeInterval = 0
    @State private var showingLoadSheet = false
    @State private var didSeed = false

    private var weeks: [ActivityLedgerWeek] {
        ActivityLedgerWeek.group(entries: entries, listedLoads: listedLoads)
    }

    private var isEmbed: Bool { style == .embed }

    var body: some View {
        LazyVStack(alignment: .leading, spacing: isEmbed ? 16 : 26) {
            if !isEmbed {
                header
            }

            ForEach(weeks) { week in
                ActivityLedgerWeekView(
                    week: week,
                    isOpen: isEmbed || openWeekIDs.contains(week.id),
                    pulledID: pulledID,
                    riffleID: riffleID,
                    pressID: pressID,
                    ignoreCardTapUntil: ignoreCardTapUntil,
                    showsHeader: !isEmbed,
                    metrics: isEmbed ? .embed : .page,
                    onToggle: { toggle(week) },
                    onPull: { pull($0) },
                    onOpen: { open($0) }
                )
            }

            if !isEmbed {
                footer()
                    .padding(.top, 2)

                Color.clear.frame(height: 8)
            }
        }
        .padding(.horizontal, isEmbed ? 0 : 16)
        // Mock's 64px includes the status-bar band inside the device frame.
        // ScrollView content already clears the safe area, so keep this tight.
        .padding(.top, isEmbed ? 0 : 12)
        .padding(.bottom, isEmbed ? 0 : 40)
        .onPreferenceChange(LedgerRiffleFramesKey.self) { riffleStore.frames = $0 }
        .background {
            if !isEmbed {
                LedgerRiffleBridge(
                    store: riffleStore,
                    pulledID: pulledID,
                    onPress: { pressID = $0 },
                    onRiffle: { riffleID = $0 },
                    onCommit: commitRiffle
                )
            }
        }
        .onAppear(perform: seedInitialState)
        .onChange(of: entries.map(\.id)) { _, _ in reconcileAfterEntriesChange() }
        .sheet(isPresented: $showingLoadSheet) {
            HowLoadIsCountedSheet()
                .presentationDetents([.height(372)])
                .presentationDragIndicator(.visible)
                .presentationContentInteraction(.resizes)
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
        guard !didSeed else {
            reconcileAfterEntriesChange()
            return
        }
        didSeed = true
        guard let firstWeek = weeks.first else { return }
        openWeekIDs = isEmbed ? Set(weeks.map(\.id)) : [firstWeek.id]
        pulledID = firstWeek.items.first?.id
    }

    /// Load-more appends entries — keep open weeks / pulled card; only fix a dangling pull.
    private func reconcileAfterEntriesChange() {
        guard didSeed else { return }
        if let pulledID, !weeks.flatMap(\.items).contains(where: { $0.id == pulledID }) {
            self.pulledID = weeks.first?.items.first?.id
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

    private func pull(_ item: ActivityLedgerItem, opensIfCurrent: Bool = true) {
        guard pulledID != item.id else {
            if opensIfCurrent {
                open(item.entry)
            }
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

    private func commitRiffle(_ id: String) {
        ignoreCardTapUntil = CACurrentMediaTime() + 0.08
        guard let item = weeks.flatMap(\.items).first(where: { $0.id == id }) else { return }
        pull(item, opensIfCurrent: false)
    }

    private func open(_ entry: SyncCacheEntry) {
        LedgerHaptics.medium()
        onSelect(entry)
    }
}

extension ActivityLedgerView where Footer == EmptyView {
    init(
        entries: [SyncCacheEntry],
        onSelect: @escaping (SyncCacheEntry) -> Void,
        onBack: (() -> Void)? = nil,
        style: ActivityLedgerStyle = .page,
        listedLoads: [String: Int] = [:]
    ) {
        self.entries = entries
        self.onSelect = onSelect
        self.onBack = onBack
        self.style = style
        self.listedLoads = listedLoads
        self.footer = { EmptyView() }
    }
}

private struct ActivityLedgerWeekView: View {
    let week: ActivityLedgerWeek
    let isOpen: Bool
    let pulledID: String?
    var riffleID: String?
    var pressID: String?
    var ignoreCardTapUntil: TimeInterval = 0
    var showsHeader: Bool = true
    var metrics: ActivityLedgerMetrics = .page
    let onToggle: () -> Void
    let onPull: (ActivityLedgerItem) -> Void
    let onOpen: (SyncCacheEntry) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: showsHeader ? 12 : 0) {
            if showsHeader {
                Button(action: onToggle) {
                    weekHeader
                }
                .buttonStyle(.plain)
            }

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
                        hiddenCount: max(0, week.items.count - 1),
                        metrics: metrics
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .padding(.top, metrics.riffleBleed)
        .padding(.horizontal, metrics.sideBleed)
        .padding(.bottom, metrics.shadowBleed)
        .frame(height: bodyHeight + metrics.shadowBleed + metrics.riffleBleed, alignment: .top)
        .clipped()
        .padding(.top, -metrics.riffleBleed)
        .padding(.horizontal, -metrics.sideBleed)
        .padding(.bottom, -metrics.shadowBleed)
    }

    private var bodyHeight: CGFloat {
        isOpen
            ? week.openBodyHeight(pulledID: pulledID, metrics: metrics)
            : metrics.closedHeight
    }

    private var openStack: some View {
        VStack(spacing: 0) {
            ForEach(Array(week.items.enumerated()), id: \.element.id) { index, item in
                let isPulled = pulledID == item.id
                let isRiffled = riffleID == item.id
                let isPressed = pressID == item.id
                let height = cardHeight(index: index, isPulled: isPulled)
                let z = Double(week.items.count - index)
                ActivityLedgerCard(
                    item: item,
                    isPulled: isPulled,
                    isRiffled: isRiffled,
                    isPressed: isPressed,
                    visibleHeight: height,
                    riffleZ: z,
                    metrics: metrics
                )
                .padding(.top, topMargin(index: index, isPulled: isPulled))
                .zIndex(z)
                .contentShape(Rectangle())
                .onTapGesture {
                    guard CACurrentMediaTime() >= ignoreCardTapUntil else { return }
                    if isPulled {
                        onOpen(item.entry)
                    } else {
                        onPull(item)
                    }
                }
            }
        }
        .padding(.top, 2)
    }

    private func cardHeight(index: Int, isPulled: Bool) -> CGFloat {
        if index == 0 {
            return isPulled ? metrics.cardHeight : metrics.peek
        }
        return metrics.cardHeight
    }

    private func topMargin(index: Int, isPulled: Bool) -> CGFloat {
        guard index > 0 else { return 0 }
        return isPulled ? metrics.pullGap : -metrics.peek
    }
}

/// One paper slip. Card 0 collapses by shrinking the stats strip to 0 —
/// clipping a full-height child was leaking labels above the row.
private struct ActivityLedgerCard: View {
    let item: ActivityLedgerItem
    let isPulled: Bool
    var isRiffled: Bool = false
    var isPressed: Bool = false
    let visibleHeight: CGFloat
    var riffleZ: Double = 0
    var metrics: ActivityLedgerMetrics = .page

    private var statsHeight: CGFloat {
        max(0, visibleHeight - metrics.peek)
    }

    private var paperShadowOpacity: Double {
        if isPulled { return metrics.pulledShadowOpacity }
        if isRiffled { return metrics.riffleShadowOpacity }
        return metrics.tuckedShadowOpacity
    }

    private var paperShadowRadius: CGFloat {
        if isPulled { return metrics.pulledShadowRadius }
        if isRiffled { return metrics.riffleShadowRadius }
        return metrics.tuckedShadowRadius
    }

    private var paperShadowY: CGFloat {
        if isPulled { return metrics.pulledShadowY }
        if isRiffled { return metrics.riffleShadowY }
        return metrics.tuckedShadowY
    }

    var body: some View {
        VStack(spacing: 0) {
            statsStrip
                .frame(height: metrics.peek, alignment: .bottom)
                .frame(height: statsHeight, alignment: .bottom)
                .clipped()
                .opacity(statsHeight < 1 ? 0 : 1)

            row
        }
        .frame(maxWidth: .infinity)
        .frame(height: visibleHeight, alignment: .bottom)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: metrics.cornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: metrics.cornerRadius, style: .continuous)
                .strokeBorder(LedgerPaper.border, lineWidth: 1)
        )
        .compositingGroup()
        .shadow(
            color: LedgerPaper.shadow.opacity(paperShadowOpacity),
            radius: paperShadowRadius,
            x: 0,
            y: paperShadowY
        )
        .scaleEffect(isPulled ? metrics.pulledScale : 1)
        .opacity(isPressed && !isRiffled ? 0.82 : 1)
        .offset(y: isRiffled ? -metrics.riffleLift : (isPressed ? -metrics.pressLift : 0))
        .animation(ActivityLedgerMetrics.cardMotion, value: isPulled)
        .animation(ActivityLedgerMetrics.cardMotion, value: visibleHeight)
        .animation(ActivityLedgerRiffle.riffleMotion, value: isRiffled)
        .animation(ActivityLedgerRiffle.pressMotion, value: isPressed)
        .background {
            if metrics.riffleLift > 0 {
                GeometryReader { geo in
                    Color.clear.preference(
                        key: LedgerRiffleFramesKey.self,
                        value: [
                            LedgerRiffleFrame(
                                id: item.id,
                                global: geo.frame(in: .global),
                                peek: metrics.peek,
                                z: riffleZ
                            )
                        ]
                    )
                }
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: metrics.cornerRadius, style: .continuous))
    }

    private var row: some View {
        HStack(spacing: metrics.rowGap) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(item.sportColor)
                .frame(width: metrics.tickWidth, height: metrics.tickHeight)

            Image(systemName: item.sportIcon)
                .font(.system(size: metrics.glyphSize, weight: .regular))
                .foregroundColor(LedgerPaper.glyph)
                .frame(width: metrics.glyphSize, height: metrics.glyphSize)

            VStack(alignment: .leading, spacing: metrics.metaGap) {
                Text(item.title)
                    .font(.system(size: metrics.titleSize, weight: .semibold))
                    .tracking(-0.15)
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)

                metaLine
            }

            Spacer(minLength: 8)

            Text(item.loadLabel)
                .font(WarmInstrument.figures(metrics.loadSize, weight: .bold))
                .tracking(-0.5)
                .foregroundColor(WarmInstrument.ink)
                .contentTransition(.numericText())
        }
        .frame(height: metrics.peek)
        .padding(.horizontal, metrics.rowPadding)
    }

    private var metaLine: some View {
        HStack(spacing: 0) {
            Text(item.dayLabel)
                .foregroundColor(item.isToday ? WarmInstrument.accent : WarmInstrument.inkMuted)
                .fontWeight(item.isToday ? .bold : .regular)
            Text(" · \(item.durationLabel)")
                .foregroundColor(WarmInstrument.inkMuted)
        }
        .font(WarmInstrument.monoLabel(metrics.metaSize, weight: .regular))
        .tracking(0.48)
        .lineLimit(1)
    }

    private var statsStrip: some View {
        HStack(spacing: metrics.statGap) {
            ForEach(item.stats) { stat in
                VStack(alignment: .leading, spacing: 4) {
                    Text(stat.value)
                        .font(WarmInstrument.figures(metrics.statSize, weight: .bold))
                        .tracking(-0.45)
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Text(stat.label)
                        .font(WarmInstrument.monoLabel(metrics.statLabelSize, weight: .bold))
                        .tracking(1.04)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: metrics.peek)
        .padding(.horizontal, metrics.rowPadding)
    }
}

private struct ActivityLedgerClosedStack: View {
    let item: ActivityLedgerItem
    let hiddenCount: Int
    var metrics: ActivityLedgerMetrics = .page

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: metrics.rowGap) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(item.sportColor)
                    .frame(width: metrics.tickWidth, height: metrics.tickHeight)

                Image(systemName: item.sportIcon)
                    .font(.system(size: metrics.glyphSize, weight: .regular))
                    .foregroundColor(LedgerPaper.glyph)
                    .frame(width: metrics.glyphSize, height: metrics.glyphSize)

                VStack(alignment: .leading, spacing: metrics.metaGap) {
                    Text(item.title)
                        .font(.system(size: metrics.titleSize, weight: .semibold))
                        .tracking(-0.15)
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(1)

                    Text(item.metaLine)
                        .font(WarmInstrument.monoLabel(metrics.metaSize, weight: .regular))
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
                        .font(WarmInstrument.figures(metrics.loadSize, weight: .bold))
                        .tracking(-0.5)
                        .foregroundColor(WarmInstrument.ink)
                }
            }
            .frame(height: metrics.peek)
            .padding(.horizontal, metrics.rowPadding)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: metrics.cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: metrics.cornerRadius, style: .continuous)
                    .strokeBorder(LedgerPaper.border, lineWidth: 1)
            )
            .shadow(
                color: LedgerPaper.shadow.opacity(metrics.tuckedShadowOpacity),
                radius: metrics.tuckedShadowRadius,
                x: 0,
                y: metrics.tuckedShadowY
            )
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

struct HowLoadIsCountedSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
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
                    // Same solid ramp Activity Detail uses (`HRZone.colors` / zone chips).
                    let zone = HRZone.colors[index]
                    let onZone = index == 0 ? WarmInstrument.ink : WarmInstrument.onAccent
                    VStack(spacing: 6) {
                        Text("Z\(index + 1)")
                            .font(WarmInstrument.monoLabel(8, weight: .bold))
                            .tracking(1.0)
                            .foregroundColor(onZone.opacity(0.85))
                        Text("×\(ActivityLedgerMetrics.zoneWeights[index])")
                            .font(WarmInstrument.figures(15, weight: .bold))
                            .tracking(-0.45)
                            .foregroundColor(onZone)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(zone)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }

            Text("WEEKLY BAND = YOUR 8-WEEK RHYTHM ±20%")
                .font(WarmInstrument.monoLabel(9, weight: .bold))
                .tracking(1.0)
                .foregroundColor(WarmInstrument.inkFaintText)
        }
        .padding(.horizontal, 24)
        .padding(.top, 18)
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

    func openBodyHeight(pulledID: String?, metrics: ActivityLedgerMetrics = .page) -> CGFloat {
        var height: CGFloat = 2
        for (index, item) in items.enumerated() {
            let isPulled = pulledID == item.id
            height += index == 0
                ? (isPulled ? metrics.cardHeight : metrics.peek)
                : metrics.cardHeight
            if index > 0 {
                height += isPulled ? metrics.pullGap : -metrics.peek
            }
        }
        return height
    }

    @MainActor
    static func group(entries: [SyncCacheEntry], listedLoads: [String: Int] = [:]) -> [ActivityLedgerWeek] {
        let items = entries.map { ActivityLedgerItem(entry: $0, listedLoad: listedLoads[$0.id]) }
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
    let durationLabel: String
    let isToday: Bool
    let weekID: String
    let weekNumber: Int
    let weekRangeLabel: String
    let load: Int?
    let stats: [ActivityLedgerStat]

    init(entry: SyncCacheEntry, listedLoad: Int? = nil) {
        let activity = entry.activity
        let badge = Theme.sportBadge(for: entry.sportType)
        let date = ActivityLedgerFormat.parseDate(entry.startDateLocal) ?? .distantPast
        let load = ActivityLedgerLoad.compute(from: activity?.hrZones) ?? listedLoad

        self.id = entry.id
        self.entry = entry
        self.title = entry.name
        self.sportColor = badge.color
        self.sportIcon = Theme.sportIcon(for: entry.sportType)
        self.startDate = date
        self.dayLabel = ActivityLedgerFormat.dayLabel(for: date)
        self.durationLabel = ActivityLedgerFormat.compactDuration(seconds: entry.elapsedTime)
        self.isToday = Calendar.current.isDateInToday(date)
        self.weekID = ActivityLedgerFormat.weekID(for: date)
        self.weekNumber = ActivityLedgerFormat.weekNumber(for: date)
        self.weekRangeLabel = ActivityLedgerFormat.weekRangeLabel(for: date)
        self.load = load
        self.stats = ActivityLedgerStat.stats(for: entry, load: load)
    }

    var metaLine: String {
        [dayLabel, durationLabel]
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
private struct ActivityLedgerMetrics: Equatable {
    var peek: CGFloat
    var cardHeight: CGFloat
    var pullGap: CGFloat
    var closedHeight: CGFloat
    var shadowBleed: CGFloat
    var sideBleed: CGFloat
    var cornerRadius: CGFloat
    var rowPadding: CGFloat
    var rowGap: CGFloat
    var statGap: CGFloat
    var metaGap: CGFloat
    var tickWidth: CGFloat
    var tickHeight: CGFloat
    var glyphSize: CGFloat
    var titleSize: CGFloat
    var loadSize: CGFloat
    var statSize: CGFloat
    var statLabelSize: CGFloat
    var metaSize: CGFloat
    var pulledScale: CGFloat
    var tuckedShadowOpacity: Double
    var tuckedShadowRadius: CGFloat
    var tuckedShadowY: CGFloat
    var pulledShadowOpacity: Double
    var pulledShadowRadius: CGFloat
    var pulledShadowY: CGFloat
    var riffleShadowOpacity: Double
    var riffleShadowRadius: CGFloat
    var riffleShadowY: CGFloat
    /// Page-only. Zero on embed so chat's ScrollView is unchanged.
    var riffleLift: CGFloat
    var pressLift: CGFloat
    var riffleBleed: CGFloat { riffleLift == 0 ? 0 : riffleLift + 16 }

    static let page = ActivityLedgerMetrics(
        peek: 64,
        cardHeight: 128,
        pullGap: 12,
        closedHeight: 84,
        shadowBleed: 30,
        sideBleed: 12,
        cornerRadius: 20,
        rowPadding: 18,
        rowGap: 12,
        statGap: 10,
        metaGap: 4,
        tickWidth: 3,
        tickHeight: 30,
        glyphSize: 20,
        titleSize: 15,
        loadSize: 17,
        statSize: 15,
        statLabelSize: 8,
        metaSize: 9.5,
        pulledScale: 1.012,
        tuckedShadowOpacity: 0.08,
        tuckedShadowRadius: 6,
        tuckedShadowY: 4,
        pulledShadowOpacity: 0.20,
        pulledShadowRadius: 14,
        pulledShadowY: 12,
        riffleShadowOpacity: 0.16,
        riffleShadowRadius: 10,
        riffleShadowY: 8,
        riffleLift: 10,
        pressLift: 2
    )

    /// Chat SESSION SYNCED — same stack, smaller so it sits with the bubbles.
    static let embed = ActivityLedgerMetrics(
        peek: 44,
        cardHeight: 88,
        pullGap: 7,
        closedHeight: 62,
        shadowBleed: 12,
        sideBleed: 8,
        cornerRadius: 14,
        rowPadding: 12,
        rowGap: 8,
        statGap: 8,
        metaGap: 2,
        tickWidth: 2.5,
        tickHeight: 22,
        glyphSize: 15,
        titleSize: 13,
        loadSize: 14,
        statSize: 12,
        statLabelSize: 7,
        metaSize: 8.5,
        pulledScale: 1,
        tuckedShadowOpacity: 0.05,
        tuckedShadowRadius: 3,
        tuckedShadowY: 1,
        pulledShadowOpacity: 0.12,
        pulledShadowRadius: 7,
        pulledShadowY: 3,
        riffleShadowOpacity: 0.05,
        riffleShadowRadius: 3,
        riffleShadowY: 1,
        riffleLift: 0,
        pressLift: 0
    )

    static let zoneWeights = [1, 2, 3, 4, 5]
    static let cardMotion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.42)
    static let weekMotion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.46).delay(0.06)
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
}
