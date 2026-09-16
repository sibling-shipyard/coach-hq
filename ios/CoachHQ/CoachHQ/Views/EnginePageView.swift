import SwiftUI

/// Pushed Engine page (Home Engine tile → push). Layout follows Engine Page v1.
struct EngineDetailView: View {
    let engine: EngineSnapshot
    let coachMessage: CoachMessageSnapshot?
    var onOpenCoach: ((CoachMessageSnapshot) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @EnvironmentObject private var allActivitiesStore: AllActivitiesStore

    @State private var showCounted = false
    @State private var plotDrawn = false

    private var relation: EnginePageMath.BandRelation? {
        EnginePageMath.bandRelation(load: engine.load, bandLow: engine.bandLow, bandHigh: engine.bandHigh)
    }

    private var groups: [EnginePageMath.DoseGroup] {
        EnginePageMath.groupedSessions(
            rows: engine.doseRows,
            dayNumbers: EnginePageMath.dayNumbers(weekLabel: engine.weekLabel)
        )
    }

    private var weekDates: Set<String> {
        EnginePageMath.weekDateKeys(weekLabel: engine.weekLabel)
    }

    private var hist: [EnginePageMath.HistSession] {
        allActivitiesStore.loadedEntries.map {
            EnginePageMath.HistSession(
                name: $0.name,
                startDateLocal: $0.startDateLocal,
                elapsedSeconds: $0.elapsedTime,
                averageHeartrate: $0.averageHeartrate ?? $0.activity?.averageHeartrate
            )
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                loadHero
                if let coachMessage {
                    receipt(coachMessage)
                }
                doseSection
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 44)
        }
        .scrollIndicators(.hidden)
        .background(WarmInstrument.desk.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .hidesMainTabBar()
        .onAppear {
            if reduceMotion {
                plotDrawn = true
            } else {
                plotDrawn = false
                DispatchQueue.main.async { plotDrawn = true }
            }
        }
        .onChange(of: showCounted) { _, open in
            if open { Haptics.tap() } else { Haptics.soft() }
        }
        .sheet(isPresented: $showCounted) {
            HowEngineIsCountedSheet()
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(WarmInstrument.paper)
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .frame(width: 44, height: 44)
                    .background(WarmInstrument.paper)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(WarmInstrument.border, lineWidth: 1))
                    .shadow(color: WarmInstrument.cardShadow, radius: 8, y: 6)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back")

            Text("Engine")
                .font(.system(size: 22, weight: .semibold))
                .tracking(-0.4)
                .foregroundColor(WarmInstrument.ink)

            Spacer(minLength: 0)

            Text(engine.weekLabel.uppercased())
                .font(WarmInstrument.monoLabel(9.5))
                .tracking(1.4)
                .foregroundColor(WarmInstrument.inkMuted)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(WarmInstrument.paper)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(WarmInstrument.border, lineWidth: 1))
        }
        .padding(.top, 8)
    }

    private var loadHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("LOAD · THIS WEEK")
                        .font(WarmInstrument.monoLabel(9))
                        .tracking(1.4)
                        .foregroundColor(WarmInstrument.onAccent.opacity(0.72))
                    Text(Format.number(engine.load))
                        .font(.system(size: 56, weight: .bold, design: .monospaced))
                        .tracking(-2.8)
                        .foregroundColor(WarmInstrument.onAccent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .contentTransition(.numericText())
                }
                Spacer(minLength: 8)
                if let relation {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(EnginePageMath.verdict(for: relation))
                            .font(WarmInstrument.coachVoice(22))
                            .foregroundColor(WarmInstrument.onAccent)
                        Text(EnginePageMath.sub(for: relation))
                            .font(WarmInstrument.monoLabel(9, weight: .regular))
                            .tracking(1.2)
                            .foregroundColor(WarmInstrument.onAccent.opacity(0.72))
                            .multilineTextAlignment(.trailing)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    if let lo = engine.bandLow, let hi = engine.bandHigh {
                        Text("USUAL BAND · \(Int(lo.rounded()))–\(Int(hi.rounded()))")
                            .font(WarmInstrument.monoLabel(9))
                            .tracking(1.4)
                            .foregroundColor(WarmInstrument.onAccent.opacity(0.72))
                    }
                    Spacer(minLength: 8)
                    if let lo = engine.bandLow, let hi = engine.bandHigh,
                       let agoLo = engine.band8wAgoLow, let agoHi = engine.band8wAgoHigh,
                       let delta = EnginePageMath.percentVs8wAgo(
                        bandLow: lo, bandHigh: hi, agoLow: agoLo, agoHigh: agoHi
                       ) {
                        Text("\(delta >= 0 ? "+" : "")\(delta)% VS 8W AGO")
                            .font(WarmInstrument.monoLabel(9))
                            .tracking(1.4)
                            .foregroundColor(WarmInstrument.onAccent.opacity(0.72))
                            .lineLimit(1)
                    }
                }

                EngineWeekPlot(
                    points: plotPoints,
                    bandLow: engine.bandLow,
                    bandHigh: engine.bandHigh,
                    projected: engine.projectedSundayLoad,
                    drawn: plotDrawn,
                    reduceMotion: reduceMotion
                )
                .frame(height: 108)
            }

            VStack(spacing: 0) {
                Rectangle()
                    .fill(WarmInstrument.onAccent.opacity(0.18))
                    .frame(height: 1)
                Button {
                    showCounted = true
                } label: {
                    HStack {
                        Spacer()
                        HStack(spacing: 6) {
                            Text("HOW IT'S COUNTED")
                                .font(WarmInstrument.monoLabel(8.5))
                                .tracking(1.2)
                                .foregroundColor(WarmInstrument.onAccent)
                            Image(systemName: "info.circle")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(WarmInstrument.onAccent)
                        }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("How it's counted")
            }
        }
        .padding(.top, 20)
        .padding(.horizontal, 22)
        .padding(.bottom, 8)
        .background(
            RoundedRectangle(cornerRadius: EnginePageLayout.heroRadius, style: .continuous)
                .fill(WarmInstrument.accent)
        )
        .shadow(color: WarmInstrument.engineShadow, radius: 12, y: 12)
    }

    private var plotPoints: [EngineWeekPlot.Point] {
        let trend = Array(engine.trend.suffix(6))
        return trend.enumerated().map { index, point in
            let isCurrent = index == trend.count - 1
            return EngineWeekPlot.Point(
                label: EnginePageMath.compactWeekLabel(point.weekLabel ?? point.label),
                load: isCurrent ? engine.load : point.value,
                isCurrent: isCurrent
            )
        }
    }

    private func receipt(_ message: CoachMessageSnapshot) -> some View {
        Button {
            Haptics.tap()
            onOpenCoach?(message)
        } label: {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .firstTextBaseline) {
                    HStack(spacing: 0) {
                        Text("COACH")
                            .font(WarmInstrument.monoLabel(9))
                            .tracking(1.4)
                            .foregroundColor(WarmInstrument.inkFaint)
                        if let subject = EnginePageMath.receiptSubject(body: message.body, doseRows: engine.doseRows) {
                            Text(" · RE: \(subject.uppercased())")
                                .font(WarmInstrument.monoLabel(9, weight: .regular))
                                .tracking(1.4)
                                .foregroundColor(WarmInstrument.inkFaint)
                        }
                    }
                    Spacer(minLength: 8)
                    Text("REPLY ›")
                        .font(WarmInstrument.monoLabel(9))
                        .tracking(1.2)
                        .foregroundColor(WarmInstrument.accent)
                }
                Text(message.body)
                    .font(WarmInstrument.coachVoice(16))
                    .foregroundColor(WarmInstrument.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                Text("— PHELPS")
                    .font(WarmInstrument.monoLabel(9, weight: .regular))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.inkFaint)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: EnginePageLayout.cardRadius, style: .continuous)
                    .fill(WarmInstrument.surfaceMuted)
            )
            .overlay(
                RoundedRectangle(cornerRadius: EnginePageLayout.cardRadius, style: .continuous)
                    .strokeBorder(WarmInstrument.border.opacity(0.75), lineWidth: 1)
            )
        }
        .buttonStyle(EngineReceiptPressStyle())
        .accessibilityLabel("Coach. \(message.body)")
        .accessibilityHint("Opens this message in Coach chat")
    }

    private var doseSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("THIS WEEK'S DOSE")
                    .font(WarmInstrument.monoLabel(10))
                    .tracking(1.4)
                    .foregroundColor(WarmInstrument.inkFaint)
                Spacer()
                Text(doseMeta)
                    .font(WarmInstrument.monoLabel(10, weight: .regular))
                    .tracking(1.4)
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            .padding(.horizontal, 6)

            if groups.isEmpty {
                emptyDose
            } else {
                doseCard
            }
        }
    }

    private var doseMeta: String {
        if groups.isEmpty { return "0 SESSIONS" }
        let count = groups.reduce(0) { $0 + $1.sessionCount }
        let sum = groups.reduce(0) { $0 + $1.loadSum }
        let noun = count == 1 ? "SESSION" : "SESSIONS"
        return "\(count) \(noun) · +\(sum)"
    }

    private var doseCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(groups.enumerated()), id: \.element.day) { index, group in
                if index > 0 {
                    Rectangle()
                        .fill(WarmInstrument.border)
                        .frame(height: 1)
                }
                doseGroup(group)
            }
        }
        .padding(.top, 4)
        .padding(.bottom, 2)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: EnginePageLayout.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: EnginePageLayout.cardRadius, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
        .shadow(color: WarmInstrument.cardShadow, radius: 10, y: 8)
    }

    private func doseGroup(_ group: EnginePageMath.DoseGroup) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HStack(spacing: 6) {
                    Text(group.day)
                        .font(WarmInstrument.monoLabel(9))
                        .tracking(1.4)
                        .foregroundColor(WarmInstrument.ink)
                    if let n = group.dayNumber {
                        Text("\(n)")
                            .font(WarmInstrument.monoLabel(9))
                            .tracking(1.4)
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                }
                Spacer()
                HStack(spacing: 0) {
                    Text(group.sessionCount == 1 ? "1 SESSION" : "\(group.sessionCount) SESSIONS")
                        .font(WarmInstrument.monoLabel(9, weight: .regular))
                        .tracking(1.4)
                        .foregroundColor(WarmInstrument.inkFaint)
                    Text(" · +\(group.loadSum)")
                        .font(WarmInstrument.monoLabel(9))
                        .tracking(1.4)
                        .foregroundColor(WarmInstrument.ink)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 13)
            .padding(.bottom, 4)

            ForEach(group.rows) { row in
                sessionRow(row)
            }
        }
    }

    private func sessionRow(_ row: DoseRowSnapshot) -> some View {
        let meta = EnginePageMath.sessionMeta(row: row, hist: hist, weekDates: weekDates)
        return HStack(alignment: .center, spacing: 12) {
            Capsule()
                .fill(WarmInstrument.sportColor(row.sport))
                .frame(width: 3, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .font(.system(size: 15, weight: .semibold))
                    .tracking(-0.15)
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)
                if let line = sessionMetaLine(meta) {
                    Text(line)
                        .font(WarmInstrument.monoLabel(8.5, weight: .regular))
                        .tracking(1.0)
                        .foregroundColor(WarmInstrument.inkFaint)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let load = row.load {
                Text("+\(Int(load.rounded()))")
                    .font(.system(size: 15, weight: .bold, design: .monospaced))
                    .foregroundColor(WarmInstrument.ink)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 9)
        .padding(.bottom, 10)
    }

    private func sessionMetaLine(_ meta: EnginePageMath.SessionMeta) -> String? {
        var parts: [String] = []
        if let minutes = meta.minutes { parts.append("\(minutes) MIN") }
        if let hr = meta.averageHR { parts.append("\(hr) BPM") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var emptyDose: some View {
        HStack(alignment: .top, spacing: 16) {
            HStack(alignment: .bottom, spacing: 4) {
                ForEach([10, 16, 22], id: \.self) { height in
                    RoundedRectangle(cornerRadius: 1, style: .continuous)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                        .foregroundColor(WarmInstrument.inkFaint)
                        .frame(width: 6, height: CGFloat(height))
                }
            }
            .frame(height: 22, alignment: .bottom)
            .padding(.top, 4)

            VStack(alignment: .leading, spacing: 8) {
                Text("Nothing logged yet")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(WarmInstrument.inkMuted)
                Text("Sessions arrive here from Health as they finish.")
                    .font(.system(size: 13.5))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Text("WEEK RESETS MON 00:00")
                    .font(WarmInstrument.monoLabel(8.5, weight: .regular))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.inkFaint)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: EnginePageLayout.cardRadius, style: .continuous)
                .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                .foregroundColor(WarmInstrument.borderDashed)
        )
    }
}

private enum EnginePageLayout {
    static let cardRadius: CGFloat = 22
    static let heroRadius: CGFloat = 26
}

private struct EngineReceiptPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

private struct EngineWeekPlot: View {
    struct Point: Identifiable {
        let label: String
        let load: Double
        let isCurrent: Bool
        var id: String { label }
    }

    let points: [Point]
    let bandLow: Double?
    let bandHigh: Double?
    let projected: Double?
    var drawn: Bool
    var reduceMotion: Bool

    private let plotHeight: CGFloat = 88
    private let barWidth: CGFloat = 14

    var body: some View {
        VStack(spacing: 6) {
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(Array(points.enumerated()), id: \.element.id) { index, point in
                    plotColumn(point, delay: Double(index) * 0.06)
                }
            }
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(WarmInstrument.onAccent.opacity(0.30))
                    .frame(height: 1)
            }
            .frame(height: plotHeight)

            HStack(spacing: 4) {
                ForEach(points) { point in
                    Text(point.label)
                        .font(WarmInstrument.monoLabel(8.5, weight: .regular))
                        .tracking(0.8)
                        .foregroundColor(WarmInstrument.onAccent.opacity(point.isCurrent ? 0.72 : 0.50))
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func plotColumn(_ point: Point, delay: Double) -> some View {
        GeometryReader { geo in
            let height = geo.size.height
            let barH = barHeight(point.load, in: height)
            let capH: CGFloat = {
                guard point.isCurrent, let projected, projected > point.load else { return 0 }
                return max(0, y(point.load, in: height) - y(projected, in: height))
            }()
            ZStack(alignment: .bottom) {
                if point.isCurrent, let lo = bandLow, let hi = bandHigh {
                    let top = y(hi, in: height)
                    let bottom = y(lo, in: height)
                    Rectangle()
                        .fill(WarmInstrument.onAccent.opacity(0.14))
                        .overlay(
                            Rectangle().strokeBorder(WarmInstrument.onAccent.opacity(0.55), lineWidth: 1)
                        )
                        .frame(width: geo.size.width, height: max(0, bottom - top))
                        .offset(y: -(height - bottom))
                }

                UnevenRoundedRectangle(
                    topLeadingRadius: 4,
                    bottomLeadingRadius: 1,
                    bottomTrailingRadius: 1,
                    topTrailingRadius: 4,
                    style: .continuous
                )
                .fill(WarmInstrument.onAccent.opacity(point.isCurrent ? 1 : 0.72))
                .frame(width: barWidth, height: max(1, barH))
                .scaleEffect(y: (drawn || reduceMotion) ? 1 : 0, anchor: .bottom)
                .animation(
                    reduceMotion ? nil : .timingCurve(0.2, 0.7, 0.2, 1, duration: 0.52).delay(delay),
                    value: drawn
                )

                if capH > 0 {
                    Rectangle()
                        .stroke(style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                        .foregroundColor(WarmInstrument.onAccent.opacity(0.6))
                        .frame(width: barWidth, height: capH)
                        .offset(y: -(barH + capH) / 2 + capH / 2)
                        .opacity((drawn || reduceMotion) ? 1 : 0)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.70), value: drawn)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        }
        .frame(maxWidth: .infinity)
    }

    private func y(_ value: Double, in height: CGFloat) -> CGFloat {
        let t = (value - EnginePageMath.plotLow) / (EnginePageMath.plotHigh - EnginePageMath.plotLow)
        return height - CGFloat(min(1, max(0, t))) * height
    }

    private func barHeight(_ value: Double, in height: CGFloat) -> CGFloat {
        height - y(value, in: height)
    }
}

private struct HowEngineIsCountedSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("How the Engine is counted")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                Spacer()
                Button("DONE") { dismiss() }
                    .font(WarmInstrument.monoLabel(9))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.accent)
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
            }

            countedRow(
                key: "LOAD",
                body: "Every minute of a session is weighted by the heart-rate zone it was spent in, 1 for recovery up to 5 for VO₂ max, then summed. A week's load is the sum of its sessions.",
                formula: "Σ (MIN × ZONE 1–5)"
            )
            Rectangle().fill(WarmInstrument.border).frame(height: 1)
            countedRow(
                key: "BAND",
                body: "Your usual rhythm: the average of the last eight full weeks, ±20%. It is fixed Monday to Sunday and moves once a week, so a big Tuesday does not shift it under you.",
                formula: "8-WK MEAN ±20% · RECOMPUTED MON"
            )

            HStack(alignment: .firstTextBaseline) {
                Text("The number is only as honest as the strap. Wear it.")
                    .font(WarmInstrument.coachVoice(15))
                    .foregroundColor(WarmInstrument.ink)
                Spacer(minLength: 8)
                Text("— PHELPS")
                    .font(WarmInstrument.monoLabel(9, weight: .regular))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            .padding(.top, 6)
        }
        .padding(.horizontal, 22)
        .padding(.top, 14)
        .padding(.bottom, 48)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(WarmInstrument.paper)
    }

    private func countedRow(key: String, body: String, formula: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(key)
                .font(WarmInstrument.monoLabel(9))
                .tracking(1.4)
                .foregroundColor(WarmInstrument.accent)
                .frame(width: 58, alignment: .leading)
            VStack(alignment: .leading, spacing: 6) {
                Text(body)
                    .font(.system(size: 14))
                    .foregroundColor(WarmInstrument.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(formula)
                    .font(WarmInstrument.monoLabel(8.5, weight: .regular))
                    .tracking(0.8)
                    .foregroundColor(WarmInstrument.inkFaint)
            }
        }
    }
}

#Preview("Engine page — golden dataset") {
    NavigationStack {
        EngineDetailView(engine: GoldenDataset.engine, coachMessage: GoldenDataset.home.coachMessage)
            .environmentObject(AllActivitiesStore())
    }
}

#Preview("Engine page — empty dose") {
    NavigationStack {
        EngineDetailView(engine: GoldenDataset.engine.withEmptyDose, coachMessage: nil)
            .environmentObject(AllActivitiesStore())
    }
}
