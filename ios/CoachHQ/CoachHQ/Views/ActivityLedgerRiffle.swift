import SwiftUI
import UIKit

/// One paper slip's window-space frame, for hold-then-drag riffle hit-testing.
struct LedgerRiffleFrame: Equatable {
    var id: String
    var global: CGRect
    var peek: CGFloat
    var z: Double
}

final class LedgerRiffleFrameStore {
    var frames: [LedgerRiffleFrame] = []
}

enum LedgerRiffleFramesKey: PreferenceKey {
    static var defaultValue: [LedgerRiffleFrame] = []

    static func reduce(value: inout [LedgerRiffleFrame], nextValue: () -> [LedgerRiffleFrame]) {
        value.append(contentsOf: nextValue())
    }
}

enum ActivityLedgerRiffle {
    static let pressDelay: TimeInterval = 0.08
    static let holdDuration: TimeInterval = 0.18
    static let slop: CGFloat = 12
    static let pressMotion = Animation.spring(duration: 0.2, bounce: 0)
    static let riffleMotion = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.22)

    /// Front-most slip whose visible paper contains `point` (window / SwiftUI global).
    static func cardID(
        at point: CGPoint,
        frames: [LedgerRiffleFrame],
        pulledID: String?
    ) -> String? {
        let ordered = frames.sorted { $0.z > $1.z }
        for frame in ordered {
            let hit: CGRect
            if frame.id == pulledID {
                hit = frame.global
            } else {
                hit = CGRect(
                    x: frame.global.minX,
                    y: frame.global.maxY - frame.peek,
                    width: frame.global.width,
                    height: frame.peek
                )
            }
            if hit.contains(point) { return frame.id }
        }
        return nil
    }
}

/// Hold-then-drag on the ancestor `UIScrollView`. Fails if the finger moves before the hold.
final class LedgerRiffleGestureRecognizer: UIGestureRecognizer {
    var onPressPoint: ((CGPoint?) -> Void)?

    private var startInView: CGPoint = .zero
    private var pressWork: DispatchWorkItem?
    private var holdWork: DispatchWorkItem?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        guard let touch = touches.first, touches.count == 1 else {
            state = .failed
            return
        }
        startInView = touch.location(in: view)
        let windowPoint = touch.location(in: nil)
        state = .possible

        let press = DispatchWorkItem { [weak self] in
            guard let self, self.state == .possible else { return }
            self.onPressPoint?(windowPoint)
        }
        pressWork = press
        DispatchQueue.main.asyncAfter(
            deadline: .now() + ActivityLedgerRiffle.pressDelay,
            execute: press
        )

        let hold = DispatchWorkItem { [weak self] in
            guard let self, self.state == .possible else { return }
            self.state = .began
        }
        holdWork = hold
        DispatchQueue.main.asyncAfter(
            deadline: .now() + ActivityLedgerRiffle.holdDuration,
            execute: hold
        )
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesMoved(touches, with: event)
        guard let touch = touches.first else { return }
        let point = touch.location(in: view)
        if state == .possible {
            if hypot(point.x - startInView.x, point.y - startInView.y) > ActivityLedgerRiffle.slop {
                failPress()
            }
        } else if state == .began || state == .changed {
            state = .changed
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        cancelWork()
        if state == .began || state == .changed {
            state = .ended
        } else if state == .possible {
            failPress()
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        cancelWork()
        onPressPoint?(nil)
        if state == .began || state == .changed {
            state = .cancelled
        } else {
            state = .failed
        }
    }

    override func reset() {
        super.reset()
        cancelWork()
    }

    private func failPress() {
        cancelWork()
        onPressPoint?(nil)
        state = .failed
    }

    private func cancelWork() {
        pressWork?.cancel()
        holdWork?.cancel()
        pressWork = nil
        holdWork = nil
    }
}

/// Installs riffle on the ancestor `UIScrollView`. This view does not hit-test.
struct LedgerRiffleBridge: UIViewRepresentable {
    var store: LedgerRiffleFrameStore
    var pulledID: String?
    var onPress: (String?) -> Void
    var onRiffle: (String?) -> Void
    var onCommit: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> InstallView {
        let view = InstallView()
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ uiView: InstallView, context: Context) {
        let coordinator = context.coordinator
        coordinator.store = store
        coordinator.pulledID = pulledID
        coordinator.onPress = onPress
        coordinator.onRiffle = onRiffle
        coordinator.onCommit = onCommit
        uiView.coordinator = coordinator
        uiView.attachIfNeeded()
    }

    static func dismantleUIView(_ uiView: InstallView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var store = LedgerRiffleFrameStore()
        var pulledID: String?
        var onPress: (String?) -> Void = { _ in }
        var onRiffle: (String?) -> Void = { _ in }
        var onCommit: (String) -> Void = { _ in }

        private weak var scrollView: UIScrollView?
        private let gesture = LedgerRiffleGestureRecognizer()
        private var riffleID: String?
        private let selection = UISelectionFeedbackGenerator()
        private let light = UIImpactFeedbackGenerator(style: .light)

        override init() {
            super.init()
            gesture.cancelsTouchesInView = false
            gesture.delegate = self
            gesture.addTarget(self, action: #selector(handle(_:)))
            gesture.onPressPoint = { [weak self] point in
                self?.setPress(point)
            }
        }

        func attach(to scrollView: UIScrollView) {
            guard self.scrollView !== scrollView else { return }
            detach()
            self.scrollView = scrollView
            scrollView.addGestureRecognizer(gesture)
        }

        func detach() {
            if let scrollView {
                scrollView.isScrollEnabled = true
                scrollView.removeGestureRecognizer(gesture)
            }
            scrollView = nil
            riffleID = nil
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            true
        }

        @objc func handle(_ gesture: LedgerRiffleGestureRecognizer) {
            let point = gesture.location(in: nil)
            switch gesture.state {
            case .began:
                scrollView?.isScrollEnabled = false
                onPress(nil)
                light.impactOccurred()
                setRiffle(ActivityLedgerRiffle.cardID(at: point, frames: store.frames, pulledID: pulledID))
            case .changed:
                setRiffle(ActivityLedgerRiffle.cardID(at: point, frames: store.frames, pulledID: pulledID))
            case .ended:
                scrollView?.isScrollEnabled = true
                if let riffleID {
                    onCommit(riffleID)
                }
                setRiffle(nil)
            default:
                scrollView?.isScrollEnabled = true
                setRiffle(nil)
                onPress(nil)
            }
        }

        private func setPress(_ point: CGPoint?) {
            if let point {
                onPress(ActivityLedgerRiffle.cardID(at: point, frames: store.frames, pulledID: pulledID))
            } else {
                onPress(nil)
            }
        }

        private func setRiffle(_ id: String?) {
            guard id != riffleID else { return }
            riffleID = id
            if id != nil {
                selection.selectionChanged()
            }
            onRiffle(id)
        }
    }

    final class InstallView: UIView {
        var coordinator: Coordinator?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            attachIfNeeded()
        }

        override func didMoveToSuperview() {
            super.didMoveToSuperview()
            attachIfNeeded()
        }

        func attachIfNeeded() {
            guard window != nil, let coordinator, let scrollView = enclosingScrollView() else { return }
            coordinator.attach(to: scrollView)
        }

        private func enclosingScrollView() -> UIScrollView? {
            var view: UIView? = superview
            while let current = view {
                if let scrollView = current as? UIScrollView {
                    return scrollView
                }
                view = current.superview
            }
            return nil
        }
    }
}
