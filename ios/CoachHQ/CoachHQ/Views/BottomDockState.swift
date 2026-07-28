import Combine
import SwiftUI

enum BottomDockMode: Equatable {
    case tabs
    case startWorkout
}

@MainActor
final class BottomDockState: ObservableObject {
    @Published var mode: BottomDockMode = .tabs
    var onStartWorkout: (() -> Void)?

    func showStartWorkout(action: @escaping () -> Void) {
        onStartWorkout = action
        mode = .startWorkout
    }

    func showTabs() {
        mode = .tabs
        onStartWorkout = nil
    }
}
