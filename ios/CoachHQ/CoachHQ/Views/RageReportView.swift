import Sentry
import Combine
import SwiftUI

class RageReportViewModel: ObservableObject {
    @Published var message: String = ""
    @Published var includeTimeline: Bool = true
    
    // Injectable for testing
    var onSubmit: ((String, Bool) -> Void)?
    
    init(onSubmit: ((String, Bool) -> Void)? = nil) {
        if let customSubmit = onSubmit {
            self.onSubmit = customSubmit
        } else {
            self.onSubmit = { msg, includeTimeline in
                SentrySDK.capture(message: msg) { scope in
                    if includeTimeline {
                        let events = TimelineBuffer.shared.getEvents()
                        if let data = try? JSONEncoder().encode(events) {
                            let attachment = Attachment(data: data, filename: "timeline.json", contentType: "application/json")
                            scope.addAttachment(attachment)
                        }
                    }
                }
            }
        }
    }
    
    func submitReport() {
        onSubmit?(message, includeTimeline)
    }
}

struct RageReportView: View {
    @StateObject private var viewModel = RageReportViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("What went wrong?")) {
                    TextEditor(text: $viewModel.message)
                        .frame(height: 150)
                }
                
                Section {
                    Toggle("Include Timeline Diagnostics", isOn: $viewModel.includeTimeline)
                    if viewModel.includeTimeline {
                        Text("\\(TimelineBuffer.shared.getEvents().count) recent events will be securely attached as JSON to help us debug.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Report a Problem")
            .navigationBarItems(
                leading: Button("Cancel") {
                    dismiss() // Cancel sends nothing
                },
                trailing: Button("Submit") {
                    viewModel.submitReport()
                    dismiss()
                }
                .disabled(viewModel.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            )
        }
    }
}
