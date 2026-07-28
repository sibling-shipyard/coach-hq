import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case home, workouts, more

    var outlineIcon: String {
        switch self {
        case .home: return "house"
        case .workouts: return "dumbbell"
        case .more: return "ellipsis.circle"
        }
    }

    var filledIcon: String {
        switch self {
        case .home: return "house.fill"
        case .workouts: return "dumbbell.fill"
        case .more: return "ellipsis.circle.fill"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .home: return "Home"
        case .workouts: return "Workouts"
        case .more: return "More"
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var workoutService: WorkoutService
    @State private var selectedTab: AppTab = .home

    var body: some View {
        Group {
            switch selectedTab {
            case .home:
                WarmInstrumentHomeView()
            case .workouts:
                WorkoutListView()
                    .environmentObject(workoutService)
            case .more:
                SettingsView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.spring(duration: 0.38, bounce: 0.12), value: selectedTab)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            WarmTabBar(selection: $selectedTab)
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
    }
}

// MARK: - Warm tab bar (main app only — not compiled into WidgetKit extension)

/// Floating icon dock — inset pill, sliding muted highlight, spring lift on the active icon.
private struct WarmTabBar: View {
    @Binding var selection: AppTab
    @Namespace private var tabIndicator

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                tabItem(tab)
            }
        }
        .padding(6)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(WarmInstrument.border.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: WarmInstrument.cardShadow, radius: 18, x: 0, y: 8)
        .shadow(color: Color(red: 57 / 255, green: 52 / 255, blue: 42 / 255).opacity(0.04), radius: 4, x: 0, y: 1)
        .padding(.horizontal, 22)
        .padding(.top, 4)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background {
            LinearGradient(
                colors: [
                    WarmInstrument.desk.opacity(0),
                    WarmInstrument.desk.opacity(0.92),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)
        }
    }

    private func tabItem(_ tab: AppTab) -> some View {
        let selected = selection == tab
        return Button {
            guard selection != tab else { return }
            Haptics.tap()
            withAnimation(.spring(duration: 0.42, bounce: 0.22)) {
                selection = tab
            }
        } label: {
            ZStack {
                if selected {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(WarmInstrument.surfaceMuted)
                        .matchedGeometryEffect(id: "tabHighlight", in: tabIndicator)
                        .shadow(color: WarmInstrument.cardShadow.opacity(0.35), radius: 4, y: 2)
                }

                Image(systemName: selected ? tab.filledIcon : tab.outlineIcon)
                    .font(.system(size: 20, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? WarmInstrument.ink : WarmInstrument.inkFaint)
                    .scaleEffect(selected ? 1.05 : 1)
                    .offset(y: selected ? -1.5 : 0)
                    .animation(.spring(duration: 0.38, bounce: 0.2), value: selected)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(TabBarPressStyle())
        .accessibilityLabel(tab.accessibilityLabel)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct TabBarPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(duration: 0.18, bounce: 0.08), value: configuration.isPressed)
    }
}
