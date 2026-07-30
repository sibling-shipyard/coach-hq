import SwiftUI

/// Shared "sign in again" screen shown over the whole app when `GitHubAuthManager.sessionExpired`
/// flips true - one implementation instead of each tab reacting to a 401 differently. Extracted
/// from Coach Chat's original per-screen version.
struct SessionExpiredView: View {
    @ObservedObject var authManager: GitHubAuthManager

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 32))
                .foregroundStyle(WarmInstrument.inkFaint)
            Text("Your GitHub access expired")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(WarmInstrument.ink)
            Text("This happens if you uninstalled the App or removed its access on GitHub's side.")
                .font(.system(size: 13))
                .foregroundStyle(WarmInstrument.inkFaint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button {
                authManager.signOut()
            } label: {
                Text("Sign in again")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(WarmInstrument.paper)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(WarmInstrument.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
