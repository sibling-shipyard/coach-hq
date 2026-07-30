import AVFoundation

final class BeepPlayer {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let sampleRate: Double = 44100
    private lazy var format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 0.45
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

    func countdown3() { play(freq: 523, ms: 70, volume: 0.18) }
    func transition()  { play(freq: 440, ms: 140, volume: 0.22) }
    func complete() {
        engine.mainMixerNode.outputVolume = 0.92
        play(freq: 392, ms: 360, volume: 0.72, decay: 2.8)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.34) { [weak self] in
            guard let self else { return }
            self.play(freq: 523, ms: 560, volume: 0.88, decay: 2.4)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.65) { [weak self] in
                self?.engine.mainMixerNode.outputVolume = 0.45
            }
        }
    }

    private func play(freq: Float, ms: Int, volume: Float, decay: Float = 6.5) {
        guard engine.isRunning else { return }
        let frameCount = AVAudioFrameCount(sampleRate * Double(ms) / 1000.0)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return }
        buffer.frameLength = frameCount
        let data = buffer.floatChannelData![0]
        let totalFrames = Float(frameCount)
        for i in 0..<Int(frameCount) {
            let t = Float(i) / Float(sampleRate)
            let progress = Float(i) / totalFrames
            let attack = min(1, t * 120)
            let envelope = attack * exp(-t * decay) * (1 - progress * 0.12)
            data[i] = sinf(2 * Float.pi * freq * t) * envelope * volume
        }
        if !player.isPlaying { player.play() }
        player.scheduleBuffer(buffer)
    }
}
