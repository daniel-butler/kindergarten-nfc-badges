/// Whether Check in starts scanning again after iOS ends a scan session. iOS stops a session
/// after about 60 seconds; walking around a classroom takes longer than that.
enum ScanPolicy {
    enum EndReason {
        case timedOut
        /// Cancel on the scan sheet, or the app stopping the session.
        case canceled
        case other
    }

    static func restartAfterEnd(reason: EndReason, stoppedByUser: Bool, registering: Bool) -> Bool {
        reason == .timedOut && !stoppedByUser && !registering
    }
}
