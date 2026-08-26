import SwiftUI

class RageReportViewModel: ObservableObject {
    @Published var message: String = ""
    @Published var includeTimeline: Bool = true
    
    func submitReport() {
        SentrySDK.capture(message: message) { scope in
            if self.includeTimeline {
                let events = TimelineBuffer.shared.getEvents()
                if let data = try? JSONEncoder().encode(events) {
                    let attachment = Attachment(data: data, filename: "timeline.json", contentType: "application/json")
                    scope.addAttachment(attachment)
                }
            }
        }
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
                }
            }
            .navigationTitle("Report a Problem")
            .navigationBarItems(
                leading: Button("Cancel") {
                    dismiss()
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
