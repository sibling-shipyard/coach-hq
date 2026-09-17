import SwiftUI

/// Shared tab/push chrome: small mono wordmark left, quiet meta right, desk behind.
/// Tabs have no back. Pushes show `‹` then the wordmark — never a circular chip.
struct WarmPageHeader<Accessory: View>: View {
    let title: String
    var trailing: String? = nil
    var showsBack: Bool = false
    var onBack: (() -> Void)? = nil
    var backAccessibilityLabel: String = "Back"
    var accessory: Accessory

    init(
        title: String,
        trailing: String? = nil,
        showsBack: Bool = false,
        onBack: (() -> Void)? = nil,
        backAccessibilityLabel: String = "Back",
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.title = title
        self.trailing = trailing
        self.showsBack = showsBack
        self.onBack = onBack
        self.backAccessibilityLabel = backAccessibilityLabel
        self.accessory = accessory()
    }

    var body: some View {
        HStack(spacing: 4) {
            if showsBack {
                Button {
                    Haptics.tap()
                    onBack?()
                } label: {
                    Text("‹")
                        .font(WarmInstrument.monoLabel(10, weight: .bold))
                        .tracking(1.2)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .frame(width: 44, height: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(backAccessibilityLabel)
            }

            Text(title.uppercased())
                .font(WarmInstrument.monoLabel(10))
                .tracking(1.4)
                .foregroundColor(WarmInstrument.ink)

            Spacer(minLength: 8)

            if let trailing, !trailing.isEmpty {
                Text(trailing.uppercased())
                    .font(WarmInstrument.monoLabel(10))
                    .tracking(1.4)
                    .foregroundColor(WarmInstrument.inkMuted)
                    .lineLimit(1)
            }

            accessory
        }
        .padding(.top, showsBack ? 0 : 14)
        .padding(.bottom, 2)
    }
}

extension WarmPageHeader where Accessory == EmptyView {
    init(
        title: String,
        trailing: String? = nil,
        showsBack: Bool = false,
        onBack: (() -> Void)? = nil,
        backAccessibilityLabel: String = "Back"
    ) {
        self.init(
            title: title,
            trailing: trailing,
            showsBack: showsBack,
            onBack: onBack,
            backAccessibilityLabel: backAccessibilityLabel
        ) {
            EmptyView()
        }
    }
}

enum WarmPageDate {
    /// `WED 16 SEP` — Train mock trailing meta.
    static func label(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE d MMM"
        return formatter.string(from: date).uppercased()
    }

    static func label(isoDay: String) -> String {
        TrainFormat.pageDate(isoDay)
    }
}
