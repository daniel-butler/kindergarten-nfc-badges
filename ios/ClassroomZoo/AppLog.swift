import Foundation
import os

/// What the phone sees: kept in a file on the phone (the Logs screen shows, copies and shares
/// it), added to the shared log on the Mac (badge-server.log) next to the server's and the
/// projector page's lines, and printed to the Xcode console. Lines written while the Mac can't be
/// reached (or the app is in the background) are sent to it once it can.
@MainActor
enum AppLog {
    /// The server to send lines to; set from the app's server URL.
    static var server = ""

    static let fileURL = URL.documentsDirectory.appending(path: "zookeeper-log.txt")
    /// The file is trimmed to its newest half once it grows past this.
    private static let maxFileBytes = 1_000_000
    private static let maxQueued = 200
    private static var pending: [String] = []
    private static var sending = false
    private static let console = Logger(subsystem: "com.rekuro.ClassroomZoo", category: "zoo")
    private static let clock: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()
    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func log(_ message: String) {
        console.log("\(message, privacy: .public)")
        let now = Date()
        let line = "\(clock.string(from: now)) \(message)"
        appendToFile("\(day.string(from: now)) \(line)\n")
        pending.append(line)
        if pending.count > maxQueued { pending.removeFirst(pending.count - maxQueued) }
        flush()
    }

    /// The newest lines of the phone's log file, oldest first.
    static func recent(lines count: Int = 400) -> String {
        guard let text = try? String(contentsOf: fileURL, encoding: .utf8) else { return "Nothing logged yet." }
        return text.split(separator: "\n").suffix(count).joined(separator: "\n")
    }

    /// Sends what's waiting to the Mac; on failure it stays queued for the next try.
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

    private static func appendToFile(_ text: String) {
        let data = Data(text.utf8)
        guard let handle = try? FileHandle(forWritingTo: fileURL) else {
            try? data.write(to: fileURL)
            return
        }
        defer { try? handle.close() }
        let size = (try? handle.seekToEnd()) ?? 0
        if size > maxFileBytes, let old = try? Data(contentsOf: fileURL) {
            try? (old.suffix(maxFileBytes / 2) + data).write(to: fileURL)
            return
        }
        try? handle.write(contentsOf: data)
    }
}
