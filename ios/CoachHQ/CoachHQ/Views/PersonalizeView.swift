import SwiftUI

/// Name collection step — shown once before HealthKit permission. Saves to AppStorage
/// so Coach can greet the user by name throughout the app.
struct NamePromptView: View {
    let onComplete: () -> Void

    @AppStorage("preferredName") private var preferredName = ""
    @State private var name = ""
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                Text("Hey. I'm\nCoach Phelps.")
                    .font(.system(size: 36, weight: .semibold, design: .serif))
                    .italic()
                    .foregroundColor(WarmInstrument.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .onboardingReveal(index: 0)
                    .padding(.bottom, 20)

                Text("What should I call you?")
                    .font(WarmInstrument.coachVoice(18))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .multilineTextAlignment(.center)
                    .onboardingReveal(index: 1)
                    .padding(.bottom, 44)

                TextField("Your name", text: $name)
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(WarmInstrument.ink)
                    .multilineTextAlignment(.center)
                    .autocorrectionDisabled()
                    .textContentType(.givenName)
                    .submitLabel(.done)
                    .focused($fieldFocused)
                    .onSubmit { submit() }
                    .padding(.bottom, 10)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(fieldFocused ? WarmInstrument.ink : WarmInstrument.border)
                            .frame(height: fieldFocused ? 1.5 : 1)
                            .animation(PremiumMotion.state, value: fieldFocused)
                    }
                    .onboardingReveal(index: 2)
            }
            .padding(.horizontal, 40)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(spacing: 12) {
                Button {
                    Haptics.tap()
                    submit()
                } label: {
                    Text("Let's go")
                }
                .buttonStyle(WarmSetupButtonStyle(primary: true))
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                .onboardingReveal(index: 3)
            }
            .padding(.horizontal, 24)
            .safeAreaPadding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
        .onAppear {
            if !preferredName.isEmpty { name = preferredName }
            fieldFocused = true
        }
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        preferredName = trimmed
        onComplete()
    }
}
