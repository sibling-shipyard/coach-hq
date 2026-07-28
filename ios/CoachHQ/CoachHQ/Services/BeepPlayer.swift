import AVFoundation

final class BeepPlayer {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let sampleRate: Double = 44100
    private lazy var format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback, mode: .default,
                options: [.mixWithOthers, .duckOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
        } catch {
            // Audio unavailable — beeps silently skipped
        }
        NotificationCenter.default.addObserver(
            self, selector: #selector(sessionInterrupted(_:)),
            name: AVAudioSession.interruptionNotification, object: nil
        )
    }

    @objc private func sessionInterrupted(_ notification: Notification) {
        guard let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: value) else { return }
        if type == .ended { try? engine.start() }
    }

    func countdown3() { play(freq: 600, ms: 100) }
    func transition()  { play(freq: 1000, ms: 200) }
    func complete() {
        play(freq: 1200, ms: 300)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.play(freq: 1400, ms: 300)
        }
    }

    private func play(freq: Float, ms: Int) {
        guard engine.isRunning else { return }
        let frameCount = AVAudioFrameCount(sampleRate * Double(ms) / 1000.0)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
        buffer.frameLength = frameCount
        let data = buffer.floatChannelData![0]
        let twoPiF = 2.0 * Float.pi * freq / Float(sampleRate)
        for i in 0..<Int(frameCount) {
            data[i] = sinf(twoPiF * Float(i)) >= 0 ? 0.15 : -0.15
        }
        if !player.isPlaying { player.play() }
        player.scheduleBuffer(buffer)
    }
}
