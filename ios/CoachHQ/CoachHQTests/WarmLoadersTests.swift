import XCTest
@testable import CoachHQ

final class WarmLoadersTests: XCTestCase {
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

    func testTurnaroundSitsOnLastBar() {
        let frame = WavePhysics.frame(at: 0.5)
        XCTAssertEqual(frame.bounce, 0, accuracy: 0.01)
    }

    func testHopPeaksOffTheGround() {
        let frame = WavePhysics.frame(at: 0.125)
        XCTAssertGreaterThan(frame.bounce, 0.4)
    }

    func testReducedMotionPoseIsOutbound() {
        let frame = WavePhysics.frame(at: WavePhysics.reducedMotionT)
        XCTAssertGreaterThan(frame.ballX, 0)
        XCTAssertLessThan(frame.ballX, CGFloat(WavePhysics.barCount - 1) * WavePhysics.barPitch)
    }
}
