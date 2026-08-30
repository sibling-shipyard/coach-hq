import Combine
import Foundation
import SwiftUI

enum RageReportSubmissionState: Equatable {
    case idle
    case queued
    case failed
    case cancelled
}

final class RageReportViewModel: ObservableObject {
    @Published var message = ""
    @Published private(set) var selectedEventIDs: Set<UUID> = []
    @Published private(set) var submissionState: RageReportSubmissionState = .idle

    let availableEvents: [TimelineEvent]

    private let submitter: any RageReportSubmitting
    private let encoder: JSONEncoder

    init(
        events: [TimelineEvent] = TimelineBuffer.shared.getEvents(),
        submitter: any RageReportSubmitting = SentryRageReportSubmitter(),
        encoder: JSONEncoder = JSONEncoder()
    ) {
        self.availableEvents = events
        self.submitter = submitter
        self.encoder = encoder
        selectedEventIDs = Set(events.map(\.id))
    }

    var selectedEventCount: Int {
        selectedEventIDs.count
    }

    var canSubmit: Bool {
        !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && submissionState != .queued
            && submissionState != .cancelled
    }

    func isSelected(_ event: TimelineEvent) -> Bool {
        selectedEventIDs.contains(event.id)
    }

    func setSelected(_ selected: Bool, for event: TimelineEvent) {
        if selected {
            selectedEventIDs.insert(event.id)
        } else {
            selectedEventIDs.remove(event.id)
        }
    }

    func selectAllEvents() {
        selectedEventIDs = Set(availableEvents.map(\.id))
    }

    func deselectAllEvents() {
        selectedEventIDs = []
    }

    func submitReport() {
        guard canSubmit else { return }

        do {
            let selectedEvents = availableEvents.filter { selectedEventIDs.contains($0.id) }
            let attachment = try selectedEvents.isEmpty ? nil : RageReportAttachment(
                data: encoder.encode(selectedEvents),
                filename: "timeline.json",
                contentType: "application/json"
            )

            // The athlete's own words, but people paste tokens and error dumps into bug
            // reports — run them through the same scrubber as everything else.
            try submitter.submit(
                message: DiagnosticsScrubber.scrub(
                    message.trimmingCharacters(in: .whitespacesAndNewlines)
                ),
                attachment: attachment
            )
            submissionState = .queued
        } catch {
            submissionState = .failed
        }
    }

    func cancelReport() {
        guard submissionState != .queued else { return }
        submissionState = .cancelled
    }
}

struct RageReportView: View {
    @StateObject private var viewModel: RageReportViewModel
    @Environment(\.dismiss) private var dismiss

    init(viewModel: @autoclosure @escaping () -> RageReportViewModel = RageReportViewModel()) {
        _viewModel = StateObject(wrappedValue: viewModel())
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    reportSection("WHAT WENT WRONG?") {
                        TextEditor(text: $viewModel.message)
                            .frame(minHeight: 120)
                            .scrollContentBackground(.hidden)
                            .font(.system(size: 14))
                            .foregroundColor(WarmInstrument.ink)
                            .disabled(viewModel.submissionState == .queued)
                    }

                    reportSection("DIAGNOSTIC EVIDENCE") {
                        if viewModel.availableEvents.isEmpty {
                            Text("No recent diagnostic events available.")
                                .font(.system(size: 14))
                                .foregroundColor(WarmInstrument.inkFaint)
                        } else {
                            let total = viewModel.availableEvents.count
                            let selected = viewModel.selectedEventCount
                            HStack(spacing: 12) {
                                Text(
                                    selected == total
                                        ? "\(total) diagnostic event\(total == 1 ? "" : "s")"
                                        : "\(selected) of \(total) diagnostic events"
                                )
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Theme.ink)
                                Spacer(minLength: 8)
                                Toggle("", isOn: evidenceSummaryBinding)
                                    .labelsHidden()
                                    .tint(WarmInstrument.accent)
                                    .disabled(viewModel.submissionState == .queued)
                            }

                            sectionDivider

                            DisclosureGroup {
                                VStack(spacing: 0) {
                                    ForEach(viewModel.availableEvents, id: \.id) { event in
                                        HStack(spacing: 12) {
                                            VStack(alignment: .leading, spacing: 3) {
                                                Text(event.message)
                                                    .font(.system(size: 13))
                                                    .foregroundColor(WarmInstrument.inkMuted)
                                                Text(
                                                    event.timestamp,
                                                    format: .dateTime.day().month().hour().minute().second()
                                                )
                                                .font(WarmInstrument.monoLabel(10))
                                                .foregroundColor(WarmInstrument.inkFaint)
                                            }
                                            Spacer(minLength: 8)
                                            Toggle(
                                                "",
                                                isOn: Binding(
                                                    get: { viewModel.isSelected(event) },
                                                    set: { viewModel.setSelected($0, for: event) }
                                                )
                                            )
                                            .labelsHidden()
                                            .tint(WarmInstrument.accent)
                                            .disabled(viewModel.submissionState == .queued)
                                        }
                                        .padding(.vertical, 8)
                                    }
                                }
                                .padding(.top, 4)
                            } label: {
                                Text("Show events")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(WarmInstrument.inkMuted)
                            }
                            .tint(WarmInstrument.inkFaint)

                            sectionDivider
                        }

                        Text("Nothing is attached until you tap Submit.")
                            .font(.system(size: 12))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }

                    switch viewModel.submissionState {
                    case .queued:
                        reportSection("STATUS") {
                            Label("Report queued for sending.", systemImage: "checkmark.circle.fill")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(WarmInstrument.sportColor(.foundation))
                        }
                    case .failed:
                        reportSection("STATUS") {
                            Label("Couldn't queue the report. Please try again.", systemImage: "exclamationmark.triangle.fill")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(WarmInstrument.accent)
                        }
                    case .idle, .cancelled:
                        EmptyView()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 32)
            }
            .background(WarmInstrument.desk.ignoresSafeArea())
            .navigationTitle("Report a Problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(viewModel.submissionState == .queued ? "Done" : "Cancel") {
                        if viewModel.submissionState != .queued {
                            viewModel.cancelReport()
                        }
                        dismiss()
                    }
                    .foregroundColor(Theme.ink)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        viewModel.submitReport()
                    }
                    .foregroundColor(WarmInstrument.accent)
                    .fontWeight(.semibold)
                    .disabled(!viewModel.canSubmit)
                }
            }
        }
    }

    private var sectionDivider: some View {
        Rectangle()
            .fill(WarmInstrument.headerRule)
            .frame(height: 1)
    }

    private func reportSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            MonoLabel(title, size: 11, tracking: 1.4)
            WarmCard(padding: 16) {
                VStack(alignment: .leading, spacing: 14) {
                    content()
                }
            }
        }
    }

    private var evidenceSummaryBinding: Binding<Bool> {
        Binding(
            get: { !viewModel.selectedEventIDs.isEmpty },
            set: { isOn in
                if isOn {
                    viewModel.selectAllEvents()
                } else {
                    viewModel.deselectAllEvents()
                }
            }
        )
    }
}
