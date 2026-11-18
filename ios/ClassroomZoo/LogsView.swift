import SwiftUI
import UIKit

/// The phone's log, to read, copy (to paste into a chat) or share as a file.
struct LogsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .defaultScrollAnchor(.bottom)
            .navigationTitle("Logs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button(copied ? "Copied ✓" : "Copy") {
                        UIPasteboard.general.string = text
                        copied = true
                    }
                    ShareLink("Share", item: AppLog.fileURL)
                }
            }
            .onAppear { text = AppLog.recent() }
        }
    }
}
