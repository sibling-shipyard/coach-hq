import Combine
import Foundation
import SwiftUI

enum RageReportSubmissionState: Equatable {
    case idle
    case sending
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
    }

    var selectedEventCount: Int {
        selectedEventIDs.count
    }

    var canSubmit: Bool {
        !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && submissionState != .sending
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

    func submitReport() {
        guard canSubmit else { return }
        submissionState = .sending

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

    init(viewModel: RageReportViewModel = RageReportViewModel()) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What went wrong?") {
                    TextEditor(text: $viewModel.message)
                        .frame(height: 150)
                        .disabled(viewModel.submissionState == .queued)
                }

                Section("Diagnostic evidence") {
                    if viewModel.availableEvents.isEmpty {
                        Text("No recent diagnostic events are available.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(viewModel.availableEvents, id: \.id) { event in
                            Toggle(
                                isOn: Binding(
                                    get: { viewModel.isSelected(event) },
                                    set: { viewModel.setSelected($0, for: event) }
                                )
                            ) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(event.message)
                                    Text(
                                        event.timestamp,
                                        format: .dateTime.day().month().hour().minute().second()
                                    )
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                            }
                            .disabled(viewModel.submissionState == .queued)
                        }
                    }

                    Text(selectionSummary)
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Text("Nothing is attached until you tap Submit.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                switch viewModel.submissionState {
                case .queued:
                    Section {
                        Label("Report queued for sending.", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                case .failed:
                    Section {
                        Label("Couldn't queue the report. Please try again.", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                case .idle, .sending, .cancelled:
                    EmptyView()
                }
            }
            .navigationTitle("Report a Problem")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(viewModel.submissionState == .queued ? "Done" : "Cancel") {
                        if viewModel.submissionState != .queued {
                            viewModel.cancelReport()
                        }
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        viewModel.submitReport()
                    }
                    .disabled(!viewModel.canSubmit)
                }
            }
        }
    }

    private var selectionSummary: String {
        let count = viewModel.selectedEventCount
        return "\(count) diagnostic event\(count == 1 ? "" : "s") selected."
    }
}
