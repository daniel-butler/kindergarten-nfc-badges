import SwiftUI

struct ContentView: View {
    @AppStorage("serverURL") private var serverURL = "http://172.20.10.2:8080"
    @StateObject private var scanner = NFCScanner()
    @State private var link = Link.checking
    @State private var showLogs = false
    @AppStorage("mode") private var mode = Mode.checkIn
    @Environment(\.scenePhase) private var phase

    /// Whether the Mac's server answered the last check.
    private enum Link: Equatable {
        case checking
        case up(badges: Int)
        case down(String)

        var text: String {
            switch self {
            case .checking: "Checking the Mac…"
            case .up(let badges): "🟢 Connected · \(badges) badges"
            case .down(let reason): "🔴 Can't reach the Mac: \(reason)"
            }
        }
    }

    private enum Mode: String, CaseIterable {
        case checkIn = "Check in"
        case register = "Register"
        case presenter = "Presenter"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                HStack(spacing: 12) {
                    Image("Puppy")
                        .resizable()
                        .scaledToFit()
                        .frame(height: 64)
                        .accessibilityHidden(true)
                    Text("Zookeeper")
                        .font(.largeTitle.bold())
                    Spacer()
                    Button { showLogs = true } label: {
                        Label("Logs", systemImage: "doc.text")
                    }
                    .buttonStyle(.bordered)
                }

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
                        Text(link.text)
                            .font(.footnote)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button("Reconnect") {
                            Task { await checkLink(logEvenIfSame: true) }
                        }
                        .buttonStyle(.bordered)
                    }
                }

                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                }
                .pickerStyle(.segmented)
                .onChange(of: mode) {
                    scanner.stop()
                    AppLog.log("mode → \(mode.rawValue)")
                }

                switch mode {
                case .register: RegisterView(server: serverURL, scanner: scanner)
                case .presenter: PresenterView(server: serverURL)
                case .checkIn: checkInView
                }
            }
            .padding()
        }
        .onAppear {
            AppLog.server = serverURL
            AppLog.log("app opened (server \(serverURL), mode \(mode.rawValue))")
        }
        .onChange(of: serverURL) { AppLog.server = serverURL }
        // While the app is open, check the Mac now and every 10 s; reopening the app checks at once.
        .task(id: "\(serverURL)|\(phase)") {
            guard phase == .active else { return }
            while !Task.isCancelled {
                await checkLink()
                try? await Task.sleep(for: .seconds(10))
            }
        }
        .sheet(isPresented: $showLogs) { LogsView() }
        .onChange(of: phase, initial: true) {
            switch phase {
            case .active: AppLog.log("app active")
            case .inactive: AppLog.log("app inactive")
            case .background: AppLog.log("app in the background")
            @unknown default: AppLog.log("app phase \(String(describing: phase))")
            }
        }
    }

    /// A trick or special badge was just scanned: decide right here, then scanning carries on.
    private func decisionCard(_ d: NFCScanner.Decision) -> some View {
        GroupBox {
            VStack(spacing: 14) {
                HStack(spacing: 14) {
                    Group {
                        if let path = d.card.image, let url = TapClient.endpoint(server: serverURL, path: path) {
                            AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
                        } else {
                            Text(d.card.emoji).font(.system(size: 54))
                        }
                    }
                    .frame(width: 80, height: 80)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(d.kind == "trick" ? "🎭 Trick badge" : "⭐ Special badge").font(.headline)
                        Text(d.card.label).font(.title.bold())
                    }
                    Spacer()
                }
                if d.kind == "trick" {
                    HStack(spacing: 12) {
                        decisionButton("👍 Let in", tint: .green) { decide(d, "let-in") }
                        decisionButton("👎 Keep out", tint: .red) { decide(d, "keep-out") }
                    }
                } else {
                    HStack(spacing: 12) {
                        decisionButton("⭐ Allow", tint: .orange) { decide(d, "allow-special") }
                        decisionButton("Not yet", tint: .gray) { decide(d, nil) }
                    }
                }
            }
        }
    }

    private func decisionButton(_ title: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.title2.bold()).frame(maxWidth: .infinity, minHeight: 64)
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
    }

    /// Sends the decision (none for "Not yet"), then scanning starts again.
    private func decide(_ d: NFCScanner.Decision, _ action: String?) {
        Task {
            if let action {
                switch await TapClient.command(action, card: d.card.canonical_id, server: serverURL) {
                case .success:
                    AppLog.log("check in: \(action) for \(d.card.label)")
                case .failure(let error):
                    AppLog.log("check in: \(action) for \(d.card.label) failed: \(error.localizedDescription)")
                    scanner.status = "⚠️ \(error.localizedDescription): try again, or use the Mac keys"
                    return
                }
            } else {
                AppLog.log("check in: not yet for \(d.card.label)")
            }
            scanner.serverURL = serverURL
            scanner.decided()
        }
    }

    /// Asks the Mac; logs when the answer changes (or always, for the Reconnect button).
    private func checkLink(logEvenIfSame: Bool = false) async {
        let next: Link
        switch await TapClient.ping(server: serverURL) {
        case .success(let badges): next = .up(badges: badges)
        case .failure(let error): next = .down(error.localizedDescription)
        }
        let wasUp = if case .up = link { true } else { false }
        let isUp = if case .up = next { true } else { false }
        if logEvenIfSame || wasUp != isUp || link == .checking {
            AppLog.log(isUp ? "connected to the Mac at \(serverURL) (\(next.text))" : "can't reach the Mac at \(serverURL): \(next.text)")
        }
        link = next
        if isUp { AppLog.flush() }
    }

    private var checkInView: some View {
        VStack(spacing: 24) {
                if let decision = scanner.decision {
                    decisionCard(decision)
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
    }
}

#Preview {
    ContentView()
}
