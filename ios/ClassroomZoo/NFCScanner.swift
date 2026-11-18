import CoreNFC
import UIKit

/// Same badge again within this window is not re-sent (a badge left on the phone is re-detected).
private let duplicateWindow: TimeInterval = 2
private let restartDelay: TimeInterval = 1

/// Core NFC objects aren't Sendable; we only ever touch them on the main queue.
private struct MainQueueOnly<T>: @unchecked Sendable {
    let value: T
}

/// Scans badge after badge in one NFC session and POSTs each UID to the server.
@MainActor
final class NFCScanner: NSObject, ObservableObject {
    @Published var isScanning = false
    @Published var status = "Tap Start Scanning"
    @Published var lastID: String?
    @Published var lastResponse: String?
    @Published var sentCount = 0

    var serverURL = ""

    private var session: NFCTagReaderSession?
    /// Set while registering: the session reads one badge, hands its UID here, and ends.
    private var onceHandler: ((String) -> Void)?
    private var lastSent: (id: String, at: Date)?
    private let haptics = UINotificationFeedbackGenerator()

    func scanOnce(_ done: @escaping (String) -> Void) {
        onceHandler = done
        start(message: "Hold the badge you're registering near the top of the iPhone.")
    }

    func start(message: String = "Hold a zoo badge near the top of the iPhone.") {
        guard NFCTagReaderSession.readingAvailable else {
            status = "NFC isn't available on this device"
            return
        }
        session?.invalidate()
        guard let session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
            status = "Couldn't start NFC"
            return
        }
        session.alertMessage = message
        self.session = session
        session.begin()
        isScanning = true
        status = "Scanning…"
        haptics.prepare()
    }

    func stop() {
        session?.invalidate()
    }

    fileprivate func handle(id: String, session: NFCTagReaderSession) {
        lastID = id
        if let done = onceHandler {
            onceHandler = nil
            haptics.notificationOccurred(.success)
            session.alertMessage = "Got it!"
            session.invalidate()
            done(id)
            return
        }
        let now = Date()
        if let last = lastSent, last.id == id, now.timeIntervalSince(last.at) < duplicateWindow {
            restart(session)
            return
        }
        lastSent = (id, now)
        sentCount += 1
        haptics.notificationOccurred(.success)
        session.alertMessage = "✓ Got it! Next badge…"
        lastResponse = "Sending…"
        let server = serverURL
        Task {
            switch await TapClient.post(id: id, server: server) {
            case .success(let summary):
                lastResponse = summary
                if session.isReady { session.alertMessage = "\(summary)\nNext badge…" }
            case .failure(let error):
                lastResponse = "⚠️ \(error.localizedDescription)"
                haptics.notificationOccurred(.error)
                if session.isReady { session.alertMessage = "⚠️ Server not reachable" }
            }
        }
        restart(session)
    }

    fileprivate func restart(_ session: NFCTagReaderSession, after delay: TimeInterval = restartDelay) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            if session.isReady { session.restartPolling() }
        }
    }

    fileprivate func ended(_ error: Error) {
        onceHandler = nil
        isScanning = false
        session = nil
        switch (error as? NFCReaderError)?.code {
        case .readerSessionInvalidationErrorUserCanceled:
            status = "Stopped. Tap Start Scanning."
        case .readerSessionInvalidationErrorSessionTimeout:
            status = "Timed out. Tap Start Scanning again."
        default:
            status = "Stopped: \(error.localizedDescription)"
        }
    }
}

// The session was created with `queue: .main`, so delegate callbacks arrive on the main thread.
extension NFCScanner: NFCTagReaderSessionDelegate {
    nonisolated func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        MainActor.assumeIsolated { ended(error) }
    }

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        MainActor.assumeIsolated {
            guard tags.count == 1, let tag = tags.first else {
                session.alertMessage = "One badge at a time!"
                restart(session, after: 0.5)
                return
            }
            let ref = MainQueueOnly(value: (session, tag))
            session.connect(to: tag) { error in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { self.connected(ref.value.0, ref.value.1, error: error) }
                }
            }
        }
    }

    private func connected(_ session: NFCTagReaderSession, _ tag: NFCTag, error: Error?) {
        guard error == nil, case let .miFare(mifare) = tag else {
            session.alertMessage = error == nil ? "That's not a zoo badge." : "Try again!"
            restart(session, after: 0.5)
            return
        }
        handle(id: TapClient.hexID(mifare.identifier), session: session)
    }
}
