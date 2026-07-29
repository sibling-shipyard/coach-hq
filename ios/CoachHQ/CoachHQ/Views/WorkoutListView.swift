import SwiftUI

struct WorkoutListView: View {
    @EnvironmentObject var workoutService: WorkoutService
    @State private var navigationPath: [Workout] = []

    private var todayId: String? { WorkoutService.todayTemplateId() }

    private var allWorkouts: [(workout: Workout, isSession: Bool)] {
        workoutService.templates.compactMap { template in
            guard let w = workoutService.displayWorkout(for: template.id) else { return nil }
            return (w, workoutService.todaySessions[template.id] != nil)
        }
    }

    private var groupedWorkouts: [(type: WorkoutType, entries: [(workout: Workout, isSession: Bool)])] {
        let order: [WorkoutType] = [.foundation, .calisthenics, .recovery, .realign]
        return order.compactMap { type in
            let entries = allWorkouts.filter { $0.workout.workoutType == type }
            return entries.isEmpty ? nil : (type, entries)
        }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if !workoutService.todaySessions.isEmpty {
                        coachAdjustedBanner
                    }

                    VStack(alignment: .leading, spacing: 20) {
                        ForEach(groupedWorkouts, id: \.type) { group in
                            workoutGroup(type: group.type, entries: group.entries)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                }
            }
            .mainTabScrollBottomClearance()
            .scrollClipDisabled()
            .refreshable {
                await workoutService.fetchTodaySessions()
            }
            .overlay {
                if workoutService.isLoading && workoutService.templates.isEmpty {
                    ProgressView()
                }
            }
            .background(Theme.mutedBackground)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Workout.self) { workout in
                WorkoutOverviewView(workout: workout)
            }
        }
    }

    private var coachAdjustedBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .semibold))
            Text("Coach has adjusted today's workout")
                .font(.system(size: 12, weight: .semibold))
        }
        .foregroundColor(WarmInstrument.sportColor(.badminton))
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WarmInstrument.sportColor(.badminton).opacity(0.08))
    }

    private func workoutGroup(
        type: WorkoutType,
        entries: [(workout: Workout, isSession: Bool)]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(Theme.workoutLabel(for: type))
                .font(WarmInstrument.monoLabel(11))
                .kerning(1.4)
                .foregroundColor(WarmInstrument.inkMuted)

            VStack(spacing: 12) {
                ForEach(entries, id: \.workout.id) { entry in
                    WarmWorkoutListCard(
                        workout: entry.workout,
                        isSession: entry.isSession,
                        isToday: entry.workout.id == todayId,
                        onTap: { navigationPath.append(entry.workout) }
                    )
                }
            }
        }
    }
}

// MARK: - Workout card (mock 3a)

struct WarmWorkoutListCard: View {
    let workout: Workout
    let isSession: Bool
    let isToday: Bool
    let onTap: () -> Void

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }
    private var blockTags: WorkoutTimerWarm.BlockTags {
        WorkoutTimerWarm.deriveBlockTags(from: workout)
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center) {
                    HStack(spacing: 6) {
                        WarmWorkoutTypeBadge(
                            label: Theme.workoutLabel(for: workout.workoutType),
                            accent: accent
                        )
                        if isToday {
                            Text("TODAY")
                                .font(WarmInstrument.monoLabel(9))
                                .kerning(1)
                                .foregroundColor(WarmInstrument.paper)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Theme.ink)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        if isSession {
                            Text("COACH")
                                .font(WarmInstrument.monoLabel(9))
                                .kerning(1)
                                .foregroundColor(WarmInstrument.sportColor(.badminton))
                        }
                    }
                    Spacer()
                    Text("→")
                        .font(.system(size: 15))
                        .foregroundColor(Color(red: 0xC2 / 255, green: 0xBC / 255, blue: 0xAE / 255))
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(workout.title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(Theme.ink)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    Text(workout.subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .lineLimit(1)
                }

                HStack(spacing: 12) {
                    Text("\(workout.estimatedDurationMins)M")
                    Text("\(workout.exerciseCount) EX")
                    Text("\(workout.setCount) SETS")
                    if !workout.location.isEmpty {
                        Text(workout.location.uppercased())
                    }
                }
                .font(WarmInstrument.figures(10))
                .foregroundColor(WarmInstrument.inkFaint)
                .lineLimit(1)

                if !blockTags.tags.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(blockTags.tags.prefix(3), id: \.self) { tag in
                            tagChip(tag)
                        }
                        let hidden = max(0, blockTags.tags.count - 3) + blockTags.overflow
                        if hidden > 0 {
                            tagChip("+\(hidden)")
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WarmInstrument.paper)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(accent)
                    .frame(height: 3)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(WarmInstrument.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: WarmInstrument.cardShadow, radius: 8, y: 4)
        }
        .buttonStyle(CardPressButtonStyle())
    }

    private func tagChip(_ text: String) -> some View {
        Text(text.uppercased())
            .font(WarmInstrument.monoLabel(9))
            .foregroundColor(WarmInstrument.inkMuted)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .stroke(Color(red: 0xDC / 255, green: 0xD5 / 255, blue: 0xC6 / 255), lineWidth: 1)
            )
    }
}

// MARK: - Simple flow layout for tag chips

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var positions: [CGPoint] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}
