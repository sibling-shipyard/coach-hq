import SwiftUI

struct WorkoutListView: View {
    @EnvironmentObject var workoutService: WorkoutService
    @State private var navigationPath: [Workout] = []

    private var todayId: String? { WorkoutService.todayTemplateId() }

    private var todayEntry: (workout: Workout, isSession: Bool)? {
        guard let id = todayId,
              let workout = workoutService.displayWorkout(for: id) else { return nil }
        return (workout, workoutService.todaySessions[id] != nil)
    }

    private var otherEntries: [(workout: Workout, isSession: Bool)] {
        workoutService.templates
            .filter { $0.id != todayId }
            .compactMap { template in
                guard let w = workoutService.displayWorkout(for: template.id) else { return nil }
                return (w, workoutService.todaySessions[template.id] != nil)
            }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    BrandHeader(title: "Timer")

                    // Coach-adjusted callout
                    if !workoutService.todaySessions.isEmpty {
                        HStack(spacing: 8) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Coach has adjusted today's workout")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundColor(Theme.accentGreen)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.accentGreen.opacity(0.08))
                    }

                    // TODAY hero
                    if let entry = todayEntry {
                        VStack(alignment: .leading, spacing: 0) {
                            SectionHeader("TODAY")
                                .padding(.horizontal, 16)
                                .padding(.top, 20)
                                .padding(.bottom, 10)
                            HeroWorkoutCard(
                                workout: entry.workout,
                                isSession: entry.isSession,
                                onTap: { navigationPath.append(entry.workout) }
                            )
                            .padding(.horizontal, 16)
                        }
                    }

                    // All workouts
                    VStack(alignment: .leading, spacing: 0) {
                        SectionHeader(todayEntry == nil ? "WORKOUTS" : "ALL WORKOUTS")
                            .padding(.horizontal, 16)
                            .padding(.top, 24)
                            .padding(.bottom, 10)

                        VStack(spacing: 0) {
                            ForEach(otherEntries, id: \.workout.id) { entry in
                                WorkoutListCell(
                                    workout: entry.workout,
                                    isSession: entry.isSession,
                                    onTap: { navigationPath.append(entry.workout) }
                                )
                            }
                            // If no today entry, show all templates as cells
                            if todayEntry == nil {
                                ForEach(workoutService.templates, id: \.id) { template in
                                    if let w = workoutService.displayWorkout(for: template.id) {
                                        WorkoutListCell(
                                            workout: w,
                                            isSession: workoutService.todaySessions[template.id] != nil,
                                            onTap: { navigationPath.append(w) }
                                        )
                                    }
                                }
                            }
                        }
                        .background(Theme.cardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                                .stroke(Theme.cardBorder, lineWidth: 1)
                        )
                        .padding(.horizontal, 16)
                    }

                    Spacer(minLength: 24)
                }
            }
            .refreshable {
                await workoutService.fetchTodaySessions()
            }
            .overlay(alignment: .center) {
                if workoutService.isLoading && workoutService.templates.isEmpty {
                    ProgressView()
                }
            }
            .background(Color(uiColor: .systemBackground))
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Workout.self) { workout in
                WorkoutOverviewView(workout: workout)
            }
        }
    }
}

// MARK: - Hero card (today's promoted workout)

struct HeroWorkoutCard: View {
    let workout: Workout
    let isSession: Bool
    let onTap: () -> Void

    private var color: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 0) {
                Rectangle().fill(color).frame(height: 4)

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Text(Theme.workoutLabel(for: workout.workoutType))
                            .font(.system(size: 9, weight: .bold)).kerning(1)
                            .foregroundColor(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(color)
                        if isSession {
                            Text("COACH ADJUSTED")
                                .font(.system(size: 9, weight: .bold)).kerning(1)
                                .foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.accentGreen)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(.secondary)
                    }

                    Text(workout.title)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundColor(.primary)

                    Text(workout.coachingNote)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                        .padding(.leading, 8)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(color).frame(width: 2)
                        }

                    HStack(spacing: 16) {
                        Label("\(workout.estimatedDurationMins)m", systemImage: "clock")
                        Label("\(workout.exerciseCount) exercises", systemImage: "dumbbell")
                        if !workout.location.isEmpty {
                            Label(workout.location, systemImage: "mappin")
                        }
                    }
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                    if !workout.equipment.isEmpty {
                        Text(workout.equipment.joined(separator: " · "))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(16)
            }
            .background(Theme.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cornerRadius)
                    .stroke(Theme.cardBorder, lineWidth: 1)
            )
        }
        .buttonStyle(CardPressButtonStyle())
    }
}

// MARK: - Compact list cell

struct WorkoutListCell: View {
    let workout: Workout
    let isSession: Bool
    let onTap: () -> Void

    private var color: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 0) {
                Rectangle().fill(color).frame(width: 4)

                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(workout.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.primary)
                        HStack(spacing: 10) {
                            Text("\(workout.estimatedDurationMins)m")
                                .font(.system(size: 12).monospacedDigit())
                            Text("·")
                            Text("\(workout.exerciseCount) exercises")
                                .font(.system(size: 12))
                            if isSession {
                                Text("COACH")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(Theme.accentGreen)
                            }
                        }
                        .foregroundColor(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color(uiColor: .tertiaryLabel))
                }
                .padding(.vertical, 14)
                .padding(.horizontal, 16)
            }
        }
        .buttonStyle(RowPressButtonStyle())
        .overlay(alignment: .bottom) {
            Divider().padding(.leading, 20)
        }
    }
}
