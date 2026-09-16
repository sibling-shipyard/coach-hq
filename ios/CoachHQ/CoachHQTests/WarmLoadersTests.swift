import XCTest
@testable import CoachHQ

final class WarmLoadersTests: XCTestCase {
    override func tearDown() {
        WavePhysics.Clock.reset()
        super.tearDown()
    }

    func testLoopStartsOnInnerBar() {
        let frame = WavePhysics.frame(at: 0)
        XCTAssertEqual(frame.ballX, WavePhysics.barPitch * CGFloat(WavePhysics.travelInset), accuracy: 0.01)
        XCTAssertEqual(frame.bars.count, WavePhysics.barCount)
    }

    func testMidpointReachesInnerEndBar() {
        let frame = WavePhysics.frame(at: 0.5)
        let expected = WavePhysics.barPitch * CGFloat(WavePhysics.barCount - 1 - WavePhysics.travelInset)
        XCTAssertEqual(frame.ballX, expected, accuracy: 0.5)
    }

    func testBallNeverVisitsEndBars() {
        let minX = WavePhysics.barPitch * CGFloat(WavePhysics.travelInset)
        let maxX = WavePhysics.barPitch * CGFloat(WavePhysics.barCount - 1 - WavePhysics.travelInset)
        for step in 0...40 {
            let x = WavePhysics.frame(at: Double(step) / 40).ballX
            XCTAssertGreaterThanOrEqual(x, minX - 0.01)
            XCTAssertLessThanOrEqual(x, maxX + 0.01)
        }
    }

    func testBarsNeverCollapse() {
        for step in 0...20 {
            let t = Double(step) / 20
            for bar in WavePhysics.frame(at: t).bars {
                XCTAssertGreaterThanOrEqual(bar.height, WavePhysics.minBarHeight)
                XCTAssertGreaterThanOrEqual(bar.wave, 0)
                XCTAssertLessThanOrEqual(bar.wave, 1)
            }
        }
    }

    func testTurnaroundHangsInTheAir() {
        let frame = WavePhysics.frame(at: 0.5)
        XCTAssertGreaterThan(frame.bounce, 0.9)
    }

    func testHopPeaksOffTheGround() {
        let frame = WavePhysics.frame(at: 0)
        XCTAssertGreaterThan(frame.bounce, 0.9)
    }

    func testReducedMotionPoseIsOutbound() {
        let frame = WavePhysics.frame(at: WavePhysics.reducedMotionT)
        XCTAssertGreaterThan(frame.ballX, 0)
        XCTAssertLessThan(frame.ballX, CGFloat(WavePhysics.barCount - 1) * WavePhysics.barPitch)
    }

    func testHopDurationIsOneOfFourInTheLoop() {
        XCTAssertEqual(WavePhysics.hopDuration, 1.3, accuracy: 0.001)
        XCTAssertEqual(WavePhysics.hopDuration, WavePhysics.loopDuration / 4, accuracy: 0.001)
    }

    func testHoldCoversWhileWaiting() {
        XCTAssertTrue(WarmPageWaitHold.shouldCover(isWaiting: true, shownAt: nil, now: Date()))
    }

    func testHoldHiddenIfNeverShown() {
        XCTAssertFalse(WarmPageWaitHold.shouldCover(isWaiting: false, shownAt: nil, now: Date()))
    }

    func testHoldKeepsCoverUntilOneHop() {
        let shown = Date(timeIntervalSinceReferenceDate: 100)
        XCTAssertTrue(
            WarmPageWaitHold.shouldCover(
                isWaiting: false,
                shownAt: shown,
                now: shown.addingTimeInterval(0.2)
            )
        )
        XCTAssertFalse(
            WarmPageWaitHold.shouldCover(
                isWaiting: false,
                shownAt: shown,
                now: shown.addingTimeInterval(WavePhysics.hopDuration + 0.01)
            )
        )
    }

    func testRemainingHoldClampsAtZero() {
        let shown = Date(timeIntervalSinceReferenceDate: 50)
        XCTAssertEqual(
            WarmPageWaitHold.remainingHold(shownAt: shown, now: shown.addingTimeInterval(0.3)),
            WavePhysics.hopDuration - 0.3,
            accuracy: 0.001
        )
        XCTAssertEqual(
            WarmPageWaitHold.remainingHold(shownAt: shown, now: shown.addingTimeInterval(4)),
            0,
            accuracy: 0.001
        )
    }

    func testClockContinuesAcrossAFastRemount() {
        let t0 = Date(timeIntervalSinceReferenceDate: 10)
        XCTAssertEqual(WavePhysics.Clock.phase(at: t0), 0, accuracy: 0.0001)
        let mid = t0.addingTimeInterval(0.1)
        let continued = WavePhysics.Clock.phase(at: mid)
        XCTAssertEqual(continued, 0.1 / WavePhysics.loopDuration, accuracy: 0.0001)
        // Bootstrap unmount → Home remount in under the resume window.
        let remount = mid.addingTimeInterval(0.2)
        let resumed = WavePhysics.Clock.phase(at: remount)
        XCTAssertEqual(resumed, 0.3 / WavePhysics.loopDuration, accuracy: 0.0001)
    }

    func testClockRestartsAfterAGap() {
        let t0 = Date(timeIntervalSinceReferenceDate: 20)
        _ = WavePhysics.Clock.phase(at: t0)
        let later = t0.addingTimeInterval(1)
        XCTAssertEqual(WavePhysics.Clock.phase(at: later), 0, accuracy: 0.0001)
    }
}
