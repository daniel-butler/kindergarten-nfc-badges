import SwiftUI

struct ContentView: View {
    @AppStorage("serverURL") private var serverURL = "http://172.20.10.2:8080"
    @StateObject private var scanner = NFCScanner()
    @State private var connection: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Text("🦁 Zoo Tap")
                    .font(.largeTitle.bold())

                VStack(alignment: .leading, spacing: 8) {
                    Text("Server URL")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("http://172.20.10.2:8080", text: $serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .font(.body.monospaced())
                    HStack {
                        Button("Test connection") {
                            connection = "Checking…"
                            Task { connection = await TapClient.check(server: serverURL) }
                        }
                        if let connection {
                            Text(connection).font(.footnote)
                        }
                    }
                }

                Button {
                    scanner.serverURL = serverURL
                    if scanner.isScanning { scanner.stop() } else { scanner.start() }
                } label: {
                    Label(scanner.isScanning ? "Stop Scanning" : "Start Scanning", systemImage: "wave.3.right")
                        .font(.title.bold())
                        .frame(maxWidth: .infinity, minHeight: 100)
                }
                .buttonStyle(.borderedProminent)
                .tint(scanner.isScanning ? .red : .green)

                Text(scanner.status)
                    .font(.headline)

                GroupBox("Last badge") {
                    VStack(spacing: 8) {
                        Text(scanner.lastID ?? "—")
                            .font(.system(.title2, design: .monospaced).bold())
                            .textSelection(.enabled)
                        Text(scanner.lastResponse ?? " ")
                            .font(.title)
                        Text("\(scanner.sentCount) taps sent")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding()
        }
    }
}

#Preview {
    ContentView()
}
