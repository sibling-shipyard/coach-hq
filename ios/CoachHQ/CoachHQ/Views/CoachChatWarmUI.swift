import SwiftUI

// MARK: - Header

struct CoachChatHeaderBar: View {
    let context: CoachChatHeaderContext
    var showsBack: Bool = false
    var onBack: (() -> Void)? = nil
    var onHistory: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 10) {
            if showsBack, let onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WarmInstrument.ink)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Back to today")
            }

            Text(context.formatted)
                .font(WarmInstrument.monoLabel(11))
                .tracking(1.4)
                .foregroundStyle(Color(red: 0x4a / 255, green: 0x4c / 255, blue: 0x46 / 255))
                .frame(maxWidth: .infinity, alignment: showsBack ? .leading : .leading)

            if let onHistory {
                Button(action: onHistory) {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(WarmInstrument.ink)
                        .frame(width: 36, height: 36)
                        .background(WarmInstrument.paper)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .strokeBorder(Color(red: 0xe2 / 255, green: 0xdb / 255, blue: 0xcd / 255), lineWidth: 1)
                        )
                }
                .accessibilityLabel("Conversation history")
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .padding(.top, 8)
        .background(WarmInstrument.desk)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(WarmInstrument.headerRule.opacity(0.85))
                .frame(height: 1)
        }
    }
}

// MARK: - Messages

struct CoachChatDayDivider: View {
    let label: String

    var body: some View {
        Text(label.uppercased())
            .font(WarmInstrument.monoLabel(9))
            .tracking(1.2)
            .foregroundStyle(Color(red: 0xb3 / 255, green: 0xb0 / 255, blue: 0xa1 / 255))
            .frame(maxWidth: .infinity)
    }
}

struct CoachChatCoachBubble: View {
    let paragraphs: [String]
    var chips: [CoachChatInlineChip] = []
    var showSignature: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(WarmInstrument.coachVoice(15))
                    .foregroundStyle(WarmInstrument.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
            }

            if !chips.isEmpty {
                FlowLayout(spacing: 7) {
                    ForEach(chips) { chip in
                        CoachChatInlineChipView(chip: chip)
                    }
                }
            }

            if showSignature {
                Text(CoachChatPreviewData.morningReadSignature)
                    .font(WarmInstrument.monoLabel(8.5))
                    .tracking(1.4)
                    .foregroundStyle(Color(red: 0xb0 / 255, green: 0x9a / 255, blue: 0x6a / 255))
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WarmInstrument.surfaceMuted)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: 18,
                bottomLeadingRadius: 18,
                bottomTrailingRadius: 18,
                topTrailingRadius: 4,
                style: .continuous
            )
        )
        .overlay(
            UnevenRoundedRectangle(
                topLeadingRadius: 18,
                bottomLeadingRadius: 18,
                bottomTrailingRadius: 18,
                topTrailingRadius: 4,
                style: .continuous
            )
            .strokeBorder(Color(red: 0xec / 255, green: 0xe2 / 255, blue: 0xcf / 255), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.05), radius: 6, x: 0, y: 2)
    }
}

struct CoachChatUserBubble: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 14.5))
            .foregroundStyle(Color(red: 0xf6 / 255, green: 0xf2 / 255, blue: 0xe8 / 255))
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .background(WarmInstrument.ink)
            .clipShape(
                UnevenRoundedRectangle(
                    topLeadingRadius: 18,
                    bottomLeadingRadius: 4,
                    bottomTrailingRadius: 18,
                    topTrailingRadius: 18,
                    style: .continuous
                )
            )
    }
}

struct CoachChatInlineChipView: View {
    let chip: CoachChatInlineChip

    var body: some View {
        switch chip.style {
        case let .engine(value, band):
            HStack(spacing: 7) {
                Text("ENGINE")
                    .font(WarmInstrument.monoLabel(8.5))
                    .tracking(1)
                    .opacity(0.7)
                Text(value)
                    .font(WarmInstrument.figures(14, weight: .bold))
                Text(band)
                    .font(WarmInstrument.monoLabel(8.5))
                    .tracking(0.8)
                    .opacity(0.8)
            }
            .foregroundStyle(WarmInstrument.paper)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(WarmInstrument.accent)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))

        case let .commitment(sportHex, label):
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(WarmInstrument.color(hex: sportHex))
                    .frame(width: 8, height: 8)
                Text(label)
                    .font(WarmInstrument.monoLabel(10))
                    .tracking(0.5)
                    .foregroundStyle(WarmInstrument.color(hex: sportHex))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(Color(red: 0xe0 / 255, green: 0xd8 / 255, blue: 0xc8 / 255), lineWidth: 1)
            )
        }
    }
}

struct CoachChatPickUpRow: View {
    let dayLabel: String
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Text(dayLabel)
                    .font(WarmInstrument.monoLabel(9.5))
                    .foregroundStyle(Color(red: 0xa8 / 255, green: 0x95 / 255, blue: 0x6a / 255))
                Text(title)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color(red: 0x4a / 255, green: 0x4c / 255, blue: 0x46 / 255))
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(red: 0xa8 / 255, green: 0xa5 / 255, blue: 0x96 / 255))
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .background(Color(red: 0xef / 255, green: 0xe9 / 255, blue: 0xdd / 255))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color(red: 0xe2 / 255, green: 0xdb / 255, blue: 0xcd / 255), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

struct CoachChatEmptyThreadPrompt: View {
    let dayLabel: String
    let threadTitle: String
    let onBackToToday: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(dayLabel.uppercased()) · \(threadTitle.uppercased())")
                .font(WarmInstrument.monoLabel(9.5))
                .tracking(1)
                .foregroundStyle(WarmInstrument.inkFaint)
            Text("No messages in this thread.")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(WarmInstrument.ink)
            Text("Coach only keeps the last seven days with something in them.")
                .font(.system(size: 13))
                .foregroundStyle(WarmInstrument.inkFaint)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onBackToToday) {
                Text("Back to today")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WarmInstrument.paper)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(WarmInstrument.accent)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 24)
    }
}

struct CoachChatThinkingBubble: View {
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { _ in
                Circle()
                    .frame(width: 6, height: 6)
                    .foregroundStyle(WarmInstrument.inkFaint)
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 14)
        .background(WarmInstrument.surfaceMuted)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: 18,
                bottomLeadingRadius: 18,
                bottomTrailingRadius: 18,
                topTrailingRadius: 4,
                style: .continuous
            )
        )
        .accessibilityLabel("Coach is thinking")
    }
}

// MARK: - Composer

struct CoachChatStarterChips: View {
    let prompts: [String]
    var isDisabled: Bool = false
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(prompts, id: \.self) { prompt in
                    Button {
                        onSelect(prompt)
                    } label: {
                        Text(prompt)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(WarmInstrument.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(WarmInstrument.paper)
                            .clipShape(Capsule())
                            .overlay(
                                Capsule()
                                    .strokeBorder(Color(red: 0xe2 / 255, green: 0xdb / 255, blue: 0xcd / 255), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(isDisabled)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

struct CoachChatComposer: View {
    @Binding var draft: String
    @FocusState.Binding var isFocused: Bool
    var placeholder: String = "Message Coach…"
    var isSending: Bool = false
    let onSend: () -> Void

    @State private var fieldHeight = CoachChatMessageField.minHeight

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 9) {
            CoachChatMessageField(
                text: $draft,
                height: $fieldHeight,
                placeholder: placeholder,
                isDisabled: isSending,
                isFocused: $isFocused
            )
            .frame(height: fieldHeight)
            .animation(.easeOut(duration: 0.12), value: fieldHeight)

            Button(action: onSend) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(WarmInstrument.paper)
                    .frame(width: 32, height: 32)
                    .background(canSend ? WarmInstrument.accent : WarmInstrument.inkFaint)
                    .clipShape(Circle())
            }
            .disabled(!canSend)
        }
        .padding(.leading, 16)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(
                    isFocused ? WarmInstrument.accent.opacity(0.55) : Color(red: 0xdd / 255, green: 0xd4 / 255, blue: 0xc3 / 255),
                    lineWidth: 1
                )
        )
        .padding(.horizontal, 16)
        .onChange(of: draft) { _, newValue in
            if newValue.isEmpty {
                fieldHeight = CoachChatMessageField.minHeight
            }
        }
    }
}

// MARK: - Minimal keyboard text view
//
// Disables QuickType / spell-check / smart punctuation. Apple does not expose APIs to remove
// the system emoji globe or dictation mic — those stay on the stock keyboard.

struct CoachChatMessageField: UIViewRepresentable {
    static let minHeight: CGFloat = 22
    static let maxHeight: CGFloat = 96
    /// Composer chrome + send button — used when the text view has not laid out yet.
    private static let widthFallbackInset: CGFloat = 108

    private static func layoutWidth(for textView: UITextView) -> CGFloat {
        if textView.bounds.width > 1 { return textView.bounds.width }
        var container: UIView? = textView.superview
        while let view = container {
            if view.bounds.width > 1 { return view.bounds.width }
            container = view.superview
        }
        if let windowWidth = textView.window?.bounds.width, windowWidth > 1 {
            return windowWidth - widthFallbackInset
        }
        return 320
    }

    @Binding var text: String
    @Binding var height: CGFloat
    var placeholder: String
    var isDisabled: Bool
    @FocusState.Binding var isFocused: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = GrowingTextView()
        view.onWidthChange = { [weak coordinator = context.coordinator] textView in
            coordinator?.syncHeight(for: textView)
        }
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = .systemFont(ofSize: 14.5)
        view.textColor = UIColor(WarmInstrument.ink)
        view.tintColor = UIColor(WarmInstrument.accent)
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.isScrollEnabled = false
        view.autocorrectionType = .no
        view.spellCheckingType = .no
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.smartInsertDeleteType = .no
        view.autocapitalizationType = .sentences
        view.keyboardType = .default
        view.returnKeyType = .default
        view.enablesReturnKeyAutomatically = false
        view.textContentType = nil
        view.inputAssistantItem.leadingBarButtonGroups = []
        view.inputAssistantItem.trailingBarButtonGroups = []
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        context.coordinator.placeholderLabel = makePlaceholder(in: view, text: placeholder)
        return view
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self

        if uiView.text != text {
            coordinator.isProgrammaticUpdate = true
            uiView.text = text
            coordinator.isProgrammaticUpdate = false
            coordinator.syncHeight(for: uiView)
        }

        uiView.isEditable = !isDisabled
        uiView.isUserInteractionEnabled = !isDisabled
        coordinator.placeholderLabel?.isHidden = !text.isEmpty
    }

    private func makePlaceholder(in textView: UITextView, text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = textView.font
        label.textColor = UIColor(WarmInstrument.inkFaint)
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        textView.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: textView.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: textView.trailingAnchor),
            label.topAnchor.constraint(equalTo: textView.topAnchor),
        ])
        return label
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: CoachChatMessageField
        weak var placeholderLabel: UILabel?
        var isProgrammaticUpdate = false

        init(parent: CoachChatMessageField) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            guard !isProgrammaticUpdate else { return }
            let newText = textView.text ?? ""
            if parent.text != newText {
                parent.text = newText
            }
            placeholderLabel?.isHidden = !newText.isEmpty
            syncHeight(for: textView)
        }

        func syncHeight(for textView: UITextView) {
            let width = CoachChatMessageField.layoutWidth(for: textView)
            let fitting = textView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
            let contentHeight = max(CoachChatMessageField.minHeight, fitting.height)
            let clamped = min(contentHeight, CoachChatMessageField.maxHeight)
            textView.isScrollEnabled = contentHeight > CoachChatMessageField.maxHeight
            guard abs(parent.height - clamped) > 0.5 else { return }
            parent.height = clamped
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }
    }
}

private final class GrowingTextView: UITextView {
    var onWidthChange: ((UITextView) -> Void)?
    private var lastWidth: CGFloat = 0

    override func layoutSubviews() {
        super.layoutSubviews()
        let width = bounds.width
        guard abs(width - lastWidth) > 0.5 else { return }
        lastWidth = width
        onWidthChange?(self)
    }
}

// MARK: - History sheet

struct CoachChatHistorySheet: View {
    let threads: [ChatThread]
    let todayThreadId: String?
    /// Real day number for the current landing thread - historyRow() derives each row's own
    /// day label from this via headerContext.dayLabel(offset:), same as the header/composer do.
    /// Was hardcoded to a literal 143 here (same bug the header used to have, just never
    /// reached when that one was fixed).
    let headerContext: CoachChatHeaderContext
    let onSelect: (ChatThread) -> Void
    let onNew: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color(red: 0xd8 / 255, green: 0xd2 / 255, blue: 0xc6 / 255))
                .frame(width: 34, height: 4)
                .padding(.top, 9)
                .padding(.bottom, 10)

            HStack {
                Text("Conversations")
                    .font(.system(size: 17, weight: .semibold))
                Text("LAST 7 DAYS")
                    .font(WarmInstrument.monoLabel(8.5))
                    .tracking(1)
                    .foregroundStyle(WarmInstrument.inkFaint)
                Spacer(minLength: 0)
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(WarmInstrument.ink)
                        .frame(width: 30, height: 30)
                        .background(WarmInstrument.paper)
                        .clipShape(Capsule())
                        .overlay(Capsule().strokeBorder(WarmInstrument.border, lineWidth: 1))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)

            ScrollView {
                LazyVStack(spacing: 2) {
                    if !todayThreads.isEmpty {
                        sectionHeader("TODAY")
                        ForEach(todayThreads) { thread in
                            historyRow(thread, isToday: true)
                        }
                    }
                    if !earlierThreads.isEmpty {
                        sectionHeader("EARLIER THIS WEEK")
                        ForEach(earlierThreads) { thread in
                            historyRow(thread, isToday: false)
                        }
                    }
                    Text("COACH KEEPS THE WEEK, NOT THE ARCHIVE.\nTHREADS CLEAR AFTER 7 DAYS.")
                        .font(WarmInstrument.monoLabel(8.5))
                        .tracking(0.6)
                        .foregroundStyle(Color(red: 0xb3 / 255, green: 0xb0 / 255, blue: 0xa1 / 255))
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.top, 14)
                }
                .padding(.horizontal, 12)
            }

            Button(action: onNew) {
                Text("New conversation")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WarmInstrument.paper)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(WarmInstrument.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(WarmInstrument.chatSurface)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.hidden)
    }

    private var todayThreads: [ChatThread] {
        threads.filter { $0.dayOffset == 0 && $0.status != .deleted }
    }

    private var earlierThreads: [ChatThread] {
        threads.filter { $0.dayOffset > 0 && $0.status != .deleted && !$0.messages.isEmpty }
            .sorted { $0.dayOffset < $1.dayOffset }
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(WarmInstrument.monoLabel(9))
            .tracking(1.2)
            .foregroundStyle(Color(red: 0xa8 / 255, green: 0xa5 / 255, blue: 0x96 / 255))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.top, 10)
            .padding(.bottom, 6)
    }

    private func historyRow(_ thread: ChatThread, isToday: Bool) -> some View {
        Button {
            onSelect(thread)
            dismiss()
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(headerContext.dayLabel(offset: thread.dayOffset))
                        .font(WarmInstrument.monoLabel(9.5))
                        .foregroundStyle(isToday ? WarmInstrument.accent : Color(red: 0xa8 / 255, green: 0x95 / 255, blue: 0x6a / 255))
                    Text(thread.title)
                        .font(.system(size: 14.5, weight: .semibold))
                        .foregroundStyle(WarmInstrument.ink)
                    Spacer(minLength: 0)
                    Text(isToday && thread.id == todayThreadId ? "OPEN" : thread.ageLabel)
                        .font(WarmInstrument.monoLabel(8.5))
                        .foregroundStyle(WarmInstrument.inkFaint)
                }
                Text(thread.preview)
                    .font(.system(size: 12))
                    .foregroundStyle(WarmInstrument.inkFaint)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isToday ? Color(red: 0xef / 255, green: 0xe9 / 255, blue: 0xdd / 255) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - First-time welcome intro

struct CoachChatWelcomeIntro: View {
    @State private var bubble1Visible = false
    @State private var bubble2Visible = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            CoachChatDayDivider(label: "DAY ONE")

            if bubble1Visible {
                HStack {
                    CoachChatCoachBubble(
                        paragraphs: ["Hey. I'm Coach Phelps."],
                        showSignature: false
                    )
                    Spacer(minLength: 40)
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

            if bubble2Visible {
                HStack {
                    CoachChatCoachBubble(
                        paragraphs: ["What should I call you?"],
                        showSignature: false
                    )
                    Spacer(minLength: 40)
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(.top, 12)
        .animation(PremiumMotion.state, value: bubble1Visible)
        .animation(PremiumMotion.state, value: bubble2Visible)
        .task { await revealSequence() }
    }

    private func revealSequence() async {
        try? await Task.sleep(for: .seconds(0.55))
        bubble1Visible = true
        try? await Task.sleep(for: .seconds(1.1))
        bubble2Visible = true
    }
}

// MARK: - Simple horizontal flow for chips

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

#if DEBUG
#Preview("Coach chat shell") {
    CoachChatPreviewHost()
}

private struct CoachChatPreviewHost: View {
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            CoachChatHeaderBar(
                context: .preview,
                onHistory: {}
            )
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    CoachChatDayDivider(label: "TODAY · D-143 · 6:58")
                    CoachChatCoachBubble(
                        paragraphs: CoachChatPreviewData.seededTodayThread.messages.compactMap { $0.paragraphs?.first }.compactMap { $0 },
                        chips: CoachChatPreviewData.morningReadChips,
                        showSignature: true
                    )
                    CoachChatPickUpRow(dayLabel: "D-142", title: "Pick up \"Bar felt cold\"") {}
                }
                .padding(16)
            }
            .background(WarmInstrument.chatSurface)
            CoachChatStarterChips(prompts: CoachChatPreviewData.starterPrompts) { draft = $0 }
            CoachChatComposer(draft: $draft, isFocused: $composerFocused) {}
                .padding(.bottom, 8)
                .background(WarmInstrument.chatSurface)
        }
        .background(WarmInstrument.desk)
    }
}
#endif
