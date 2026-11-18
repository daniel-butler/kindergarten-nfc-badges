import Combine
import SwiftUI

/// Phone remote for the projector page: every button runs the same thing as a Mac shortcut.
struct PresenterView: View {
    let server: String

    @State private var info: PresenterDTO?
    @State private var status: String?
    @State private var showHelp = false
    @State private var confirmReset = false
    private let refresh = Timer.publish(every: 1.5, on: .main, in: .common).autoconnect()
    private let haptics = UINotificationFeedbackGenerator()

    private static let scenes: [(title: String, action: String)] = [
        ("🔢 Secret", "scene-secret"), ("🎠 Zoo", "scene-zoo"), ("📋 List", "scene-list"),
        ("❓ Who has", "scene-who"), ("🏰 Gate 2D", "scene-gate"), ("🛠️ Setup", "scene-setup"),
        ("🐞 Debug", "scene-debug"),
    ]

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 12) {
                Image("Bee").resizable().scaledToFit().frame(height: 52).accessibilityHidden(true)
                Text("Presenter").font(.title.bold())
                Spacer()
                Button {
                    showHelp = true
                } label: {
                    Label("Help", systemImage: "keyboard")
                }
                .buttonStyle(.bordered)
            }

            waitingCard

            HStack(spacing: 12) {
                commandButton("👍 Let in", "let-in", tint: .green)
                commandButton("👎 Keep out", "keep-out", tint: .red)
            }
            commandButton("⭐ Allow special", "allow-special", tint: .orange)
            HStack(spacing: 12) {
                commandButton("📋 Zoo List", "toggle-list", tint: .blue)
                commandButton("🎉 Party", "party", tint: .purple)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 100))], spacing: 10) {
                ForEach(Self.scenes, id: \.action) { scene in
                    Button(scene.title) { run(scene.action) }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                }
            }

            Button(role: .destructive) {
                confirmReset = true
            } label: {
                Label("Reset the zoo", systemImage: "arrow.counterclockwise")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .confirmationDialog("Reset the zoo?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset", role: .destructive) { run("reset") }
            } message: {
                Text("Clears the tally, everyone inside, the trick votes and the party, and denies the special badge again.")
            }

            if let status {
                Text(status).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .task { await load() }
        .onReceive(refresh) { _ in Task { await load() } }
        .sheet(isPresented: $showHelp) { ShortcutHelp() }
    }

    @ViewBuilder
    private var waitingCard: some View {
        GroupBox {
            VStack(spacing: 6) {
                if let waiting = info?.waiting {
                    HStack(spacing: 14) {
                        art(waiting.card).frame(width: 72, height: 72)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(waiting.kind == "special" ? "⭐ Special badge waiting" : "🎭 Trick badge waiting")
                                .font(.headline)
                            Text(waiting.card.label).font(.title2.bold())
                            Text(waiting.raw_id).font(.system(.footnote, design: .monospaced)).textSelection(.enabled)
                        }
                        Spacer()
                    }
                } else {
                    Text("Nothing waiting").font(.headline).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                if let unknown = info?.last_unknown {
                    Text("Last unknown: \(unknown.raw_id)")
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    @ViewBuilder
    private func art(_ card: CardDTO) -> some View {
        if let path = card.image, let url = TapClient.endpoint(server: server, path: path) {
            AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { ProgressView() }
        } else {
            Text(card.emoji).font(.system(size: 54))
        }
    }

    private func commandButton(_ title: String, _ action: String, tint: Color) -> some View {
        Button { run(action) } label: {
            Text(title).font(.title3.bold()).frame(maxWidth: .infinity, minHeight: 56)
        }
        .buttonStyle(.borderedProminent)
        .tint(tint)
    }

    private func run(_ action: String) {
        Task {
            switch await TapClient.command(action, server: server) {
            case .success:
                haptics.notificationOccurred(.success)
                status = "✓ Sent: \(action)"
                await load()
            case .failure(let error):
                haptics.notificationOccurred(.error)
                status = "⚠️ \(error.localizedDescription) — use the Mac shortcuts (Help)"
            }
        }
    }

    private func load() async {
        if case .success(let fresh) = await TapClient.presenter(server: server) { info = fresh }
    }
}

/// Every Mac shortcut, for when the phone can't reach the Mac.
private struct ShortcutHelp: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(TapClient.shortcuts, id: \.key) { shortcut in
                HStack {
                    Text(shortcut.key).font(.system(.body, design: .monospaced).bold()).frame(width: 90, alignment: .leading)
                    Text(shortcut.action)
                }
            }
            .navigationTitle("Mac shortcuts")
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}
