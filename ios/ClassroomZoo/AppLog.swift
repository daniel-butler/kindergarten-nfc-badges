import Foundation
import os

/// What the phone sees, added to the shared log on the Mac (badge-server.log) next to the
/// server's and the projector page's lines, and to the Xcode console. Lines written while the
/// Mac can't be reached (or the app is in the background) are sent once it can.
@MainActor
enum AppLog {
    /// The server to send lines to; set from the app's server URL.
    static var server = ""

    private static let maxQueued = 200
    private static var pending: [String] = []
    private static var sending = false
    private static let console = Logger(subsystem: "com.rekuro.ClassroomZoo", category: "zoo")
    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    static func log(_ message: String) {
        console.log("\(message, privacy: .public)")
        pending.append("\(clock.string(from: Date())) \(message)")
        if pending.count > maxQueued { pending.removeFirst(pending.count - maxQueued) }
        flush()
    }

    /// Sends what's waiting; on failure it stays queued for the next try.
    static func flush() {
        guard !sending, !pending.isEmpty, !server.isEmpty else { return }
        sending = true
        let lines = Array(pending.prefix(50))
        Task {
            let sent = await TapClient.postLog(lines, server: server)
            sending = false
            if sent {
                pending.removeFirst(min(lines.count, pending.count))
                flush()
            }
        }
    }
}
