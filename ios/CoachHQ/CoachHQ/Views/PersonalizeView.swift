import SwiftUI

struct NamePromptView: View {
    let onComplete: () -> Void

    @AppStorage("preferredName") private var preferredName = ""
    @State private var name = ""
    @FocusState private var fieldFocused: Bool

    @State private var showTyping1 = false
    @State private var showFirstBubble = false
    @State private var showTyping2 = false
    @State private var showSecondBubble = false
    @State private var showInputBubble = false

    var body: some View {
        ZStack {
            WarmInstrument.desk.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()
                chatArea
                    .padding(.horizontal, 20)
                // Two spacers below push chat into upper portion
                Spacer()
                Spacer()
            }
        }
        .task {
            await runChatEntrance()
        }
    }

    private var chatArea: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Coach bubble 1
            HStack(alignment: .bottom, spacing: 0) {
                if showFirstBubble {
                    NameChatBubble(isCoach: true) {
                        Text("Hey! I'm Coach Phelps.")
                            .font(WarmInstrument.coachVoice(16))
                            .foregroundColor(WarmInstrument.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.85, anchor: .bottomLeading).combined(with: .opacity),
                        removal: .opacity
                    ))
                } else if showTyping1 {
                    NameChatBubble(isCoach: true) {
                        NameTypingIndicator()
                    }
                    .transition(.opacity)
                }
                Spacer(minLength: 64)
            }
            .animation(PremiumMotion.state, value: showFirstBubble)
            .animation(PremiumMotion.state, value: showTyping1)

            // Coach bubble 2
            HStack(alignment: .bottom, spacing: 0) {
                if showSecondBubble {
                    NameChatBubble(isCoach: true) {
                        Text("What should I call you?")
                            .font(WarmInstrument.coachVoice(16))
                            .foregroundColor(WarmInstrument.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.85, anchor: .bottomLeading).combined(with: .opacity),
                        removal: .opacity
                    ))
                } else if showTyping2 {
                    NameChatBubble(isCoach: true) {
                        NameTypingIndicator()
                    }
                    .transition(.opacity)
                }
                Spacer(minLength: 64)
            }
            .animation(PremiumMotion.state, value: showSecondBubble)
            .animation(PremiumMotion.state, value: showTyping2)

            // User reply bubble (right-aligned) with send button inside, matching chat page
            if showInputBubble {
                HStack(alignment: .bottom, spacing: 0) {
                    Spacer(minLength: 40)
                    NameChatBubble(isCoach: false) {
                        let canSend = !name.trimmingCharacters(in: .whitespaces).isEmpty
                        HStack(spacing: 8) {
                            TextField("", text: $name)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(WarmInstrument.ink)
                                .multilineTextAlignment(.leading)
                                .autocorrectionDisabled()
                                .textContentType(.givenName)
                                .submitLabel(.done)
                                .focused($fieldFocused)
                                .onSubmit { submit() }
                                .frame(minWidth: 80)
                            Button {
                                Haptics.tap()
                                submit()
                            } label: {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(WarmInstrument.paper)
                                    .frame(width: 28, height: 28)
                                    .background(canSend ? WarmInstrument.accent : WarmInstrument.inkFaint)
                                    .clipShape(Circle())
                            }
                            .disabled(!canSend)
                            .animation(PremiumMotion.state, value: canSend)
                        }
                    }
                }
                .transition(.asymmetric(
                    insertion: .scale(scale: 0.85, anchor: .bottomTrailing).combined(with: .opacity),
                    removal: .opacity
                ))
                .animation(PremiumMotion.state, value: showInputBubble)
            }
        }
    }

    private func runChatEntrance() async {
        try? await Task.sleep(for: .seconds(0.4))
        withAnimation(PremiumMotion.state) { showTyping1 = true }
        try? await Task.sleep(for: .seconds(0.65))
        withAnimation(PremiumMotion.state) {
            showTyping1 = false
            showFirstBubble = true
        }
        try? await Task.sleep(for: .seconds(0.45))
        withAnimation(PremiumMotion.state) { showTyping2 = true }
        try? await Task.sleep(for: .seconds(0.55))
        withAnimation(PremiumMotion.state) {
            showTyping2 = false
            showSecondBubble = true
        }
        try? await Task.sleep(for: .seconds(0.3))
        withAnimation(PremiumMotion.state) { showInputBubble = true }
        try? await Task.sleep(for: .seconds(0.25))
        fieldFocused = true
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        preferredName = trimmed
        OnboardingHints.save(name: trimmed)
        onComplete()
    }
}

// MARK: - Chat Bubble

private struct NameChatBubble<Content: View>: View {
    let isCoach: Bool
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(isCoach ? WarmInstrument.paper : WarmInstrument.surfaceMuted)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(isCoach ? WarmInstrument.border : Color.clear, lineWidth: 1)
            )
            .shadow(color: isCoach ? WarmInstrument.cardShadow : .clear, radius: 10, y: 5)
    }
}

// MARK: - Typing Indicator

private struct NameTypingIndicator: View {
    @State private var animate = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(WarmInstrument.inkFaint)
                    .frame(width: 6, height: 6)
                    .offset(y: animate ? -3 : 0)
                    .animation(
                        .easeInOut(duration: 0.45)
                            .repeatForever()
                            .delay(Double(i) * 0.15),
                        value: animate
                    )
            }
        }
        .padding(.vertical, 2)
        .onAppear { withAnimation { animate = true } }
    }
}
