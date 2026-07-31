import SwiftUI

/// Minimal brand splash shown once on first launch — logo + wordmark, no form.
/// Fades out to reveal the Chat tab (which has been loading underneath).
/// Name collection happens conversationally inside the Coach chat intro.
struct SplashView: View {
    let onComplete: () -> Void

    @State private var logoOpacity: Double = 0
    @State private var wordmarkOpacity: Double = 0
    @State private var isExiting = false

    var body: some View {
        VStack(spacing: 14) {
            OnboardingLogo(size: 68)
                .opacity(logoOpacity)

            Text("Coach HQ")
                .font(WarmInstrument.coachVoice(26))
                .foregroundColor(WarmInstrument.ink)
                .opacity(wordmarkOpacity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
        .opacity(isExiting ? 0 : 1)
        .animation(.easeIn(duration: 0.42), value: isExiting)
        .task { await runSequence() }
    }

    private func runSequence() async {
        withAnimation(.spring(duration: 0.55, bounce: 0.12)) { logoOpacity = 1 }
        try? await Task.sleep(for: .seconds(0.28))
        withAnimation(.easeOut(duration: 0.42)) { wordmarkOpacity = 1 }
        try? await Task.sleep(for: .seconds(1.9))
        isExiting = true
        try? await Task.sleep(for: .seconds(0.45))
        onComplete()
    }
}
