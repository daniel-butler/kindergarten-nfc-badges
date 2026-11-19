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
    /// A trick or special badge just scanned that the presenter decides about on this screen.
    @Published var decision: Decision?

    /// What to tell the presenter next, e.g. that the golden badge needs one more scan.
    @Published var hint: String?

    struct Decision: Equatable {
        /// "trick", "special", or "fix" (a kept-out trick badge whose picture can be fixed).
        let kind: String
        let card: CardDTO
    }

    var serverURL = ""

    private var session: NFCTagReaderSession?
    /// Set while registering: the session reads one badge, hands its UID here, and ends.
    private var onceHandler: ((String) -> Void)?
    private var lastSent: (id: String, at: Date)?
    /// Scanning stopped so the decision buttons can be tapped (the NFC sheet covers them).
    private var pausedForDecision = false
    /// The presenter tapped Stop: don't start again on our own.
    private var stoppedByUser = false
    private let haptics = UINotificationFeedbackGenerator()
    #if DEBUG
    /// UI tests run in the simulator, which has no NFC: ZOO_FAKE_TAGS="ID1,ID2" stands in for
    /// badges held to the phone, read one after another.
    private var fakeTags = ProcessInfo.processInfo.environment["ZOO_FAKE_TAGS"]
        .map { $0.split(separator: ",").map(String.init) }
    #endif

    func scanOnce(_ done: @escaping (String) -> Void) {
        onceHandler = done
        start(message: "Hold the badge you're registering near the top of the iPhone.")
    }

    func start(message: String = "Hold a zoo badge near the top of the iPhone.") {
        #if DEBUG
        if fakeTags != nil { return startFake() }
        #endif
        guard NFCTagReaderSession.readingAvailable else {
            status = "NFC isn't available on this device"
            AppLog.log("NFC isn't available on this device")
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
        stoppedByUser = false
        AppLog.log(onceHandler == nil ? "NFC scanning started" : "NFC scanning for one badge to register")
        isScanning = true
        status = "Scanning…"
        haptics.prepare()
    }

    func stop() {
        stoppedByUser = true
        hint = nil
        session?.invalidate()
    }

    fileprivate func handle(id: String, session: NFCTagReaderSession) {
        lastID = id
        hint = nil
        AppLog.log("badge read \(id)")
        if let done = onceHandler {
            onceHandler = nil
            haptics.notificationOccurred(.success)
            session.alertMessage = "Got it!"
            session.invalidate()
            done(id)
            return
        }
        if send(id, alert: { if session.isReady { session.alertMessage = $0 } }) {
            session.alertMessage = "✓ Got it! Next badge…"
        }
        restart(session)
    }

    /// Records one read and POSTs it; `alert` shows the outcome on the NFC sheet.
    /// Returns false for the same badge again within the duplicate window.
    private func send(_ id: String, alert: @escaping (String) -> Void) -> Bool {
        let now = Date()
        if let last = lastSent, last.id == id, now.timeIntervalSince(last.at) < duplicateWindow {
            return false
        }
        lastSent = (id, now)
        sentCount += 1
        haptics.notificationOccurred(.success)
        lastResponse = "Sending…"
        let server = serverURL
        Task {
            switch await TapClient.post(id: id, server: server) {
            case .success(let reply):
                lastResponse = reply.summary
                AppLog.log("tap \(id) sent: \(reply.summary)\(reply.waiting.map { " (\($0) waiting)" } ?? "")")
                if let kind = reply.waiting, let card = reply.card {
                    pause(for: Decision(kind: kind, card: card))
                } else {
                    alert("\(reply.summary)\nNext badge…")
                }
            case .failure(let error):
                lastResponse = "⚠️ \(error.localizedDescription)"
                AppLog.log("tap \(id) not sent: \(error.localizedDescription)")
                haptics.notificationOccurred(.error)
                alert("⚠️ Server not reachable")
            }
        }
        return true
    }

    /// Stops scanning so the presenter can decide on this screen; `decided()` picks it up again.
    private func pause(for decision: Decision) {
        self.decision = decision
        AppLog.log("waiting for the presenter: \(decision.kind) \(decision.card.label)")
        guard let session else { return }
        pausedForDecision = true
        session.alertMessage = decision.kind == "trick" ? "🎭 Trick badge! Decide on the phone." : "⭐ Golden badge! Decide on the phone."
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { session.invalidate() }
    }

    /// The presenter decided: scanning starts again.
    /// `hint` stays on screen and on the scan sheet until the next badge is read.
    func decided(hint: String? = nil) {
        decision = nil
        self.hint = hint
        if let hint { start(message: hint) } else { start() }
    }

    #if DEBUG
    /// Reads the fake badges as if held to the phone: one for a register scan, all of them otherwise.
    private func startFake() {
        isScanning = true
        status = "Scanning…"
        Task {
            while let id = fakeTags?.first {
                try? await Task.sleep(nanoseconds: 300_000_000)
                fakeTags?.removeFirst()
                lastID = id
                hint = nil
                AppLog.log("badge read \(id) (test badge)")
                if let done = onceHandler {
                    onceHandler = nil
                    isScanning = false
                    status = "Tap Start Scanning"
                    done(id)
                    return
                }
                _ = send(id, alert: { _ in })
            }
            isScanning = false
            status = "Stopped. Tap Start Scanning."
        }
    }
    #endif

    fileprivate func restart(_ session: NFCTagReaderSession, after delay: TimeInterval = restartDelay) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            if session.isReady { session.restartPolling() }
        }
    }

    fileprivate func ended(_ error: Error) {
        let registering = onceHandler != nil
        onceHandler = nil
        isScanning = false
        session = nil
        AppLog.log("NFC session ended: \(error.localizedDescription)")
        if pausedForDecision {
            pausedForDecision = false
            status = "Decide below 👇"
            return
        }
        let code = (error as? NFCReaderError)?.code
        let reason: ScanPolicy.EndReason = switch code {
        case .readerSessionInvalidationErrorSessionTimeout: .timedOut
        case .readerSessionInvalidationErrorUserCanceled: .canceled
        default: .other
        }
        if ScanPolicy.restartAfterEnd(reason: reason, stoppedByUser: stoppedByUser, registering: registering) {
            AppLog.log("scan timed out: starting again")
            status = "Scanning…"
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self, !self.stoppedByUser, self.session == nil, self.decision == nil else { return }
                self.start()
            }
            return
        }
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
