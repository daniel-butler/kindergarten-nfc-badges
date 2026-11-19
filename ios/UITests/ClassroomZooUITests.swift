import XCTest

/// The phone half of the phone + page tests in e2e/tests/phone.spec.js. That test sets up the server
/// and the projector page, runs one of these in the simulator, then checks the page.
///
/// Settings arrive through xcodebuild's TEST_RUNNER_ prefix:
/// - BADGE_SERVER: the server URL the app talks to
/// - ZOO_FAKE_TAGS: comma-separated badge IDs the app reads instead of NFC (debug builds only)
/// - PHONE_EXPECT: text the phone should show (an animal's label or tap summary)
final class ClassroomZooUITests: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private let wait: TimeInterval = 15

    override func setUp() {
        continueAfterFailure = false
    }

    private var expected: String { env["PHONE_EXPECT"] ?? "" }

    private func launch(mode: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-serverURL", env["BADGE_SERVER"] ?? "http://localhost:8181", "-mode", mode]
        if let tags = env["ZOO_FAKE_TAGS"] { app.launchEnvironment["ZOO_FAKE_TAGS"] = tags }
        app.launch()
        return app
    }

    private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.staticTexts[label]
    }

    func testCheckInSendsTaps() {
        let app = launch(mode: "Check in")
        XCTAssert(text(app, "Zookeeper").waitForExistence(timeout: wait), "the app is called Zookeeper")
        app.buttons["Start Scanning"].tap()
        XCTAssert(text(app, expected).waitForExistence(timeout: wait), "phone shows \(expected)")
    }

    func testPresenterLetsInTrick() {
        let app = launch(mode: "Presenter")
        XCTAssert(text(app, "🎭 Trick badge waiting").waitForExistence(timeout: wait))
        XCTAssert(text(app, expected).exists, "waiting card shows \(expected)")
        app.buttons["👍 Let in"].tap()
        XCTAssert(text(app, "✓ Sent: let-in").waitForExistence(timeout: wait))
        XCTAssert(text(app, "Nothing waiting").waitForExistence(timeout: wait))
    }

    func testPresenterKeepsOutTrick() {
        let app = launch(mode: "Presenter")
        XCTAssert(text(app, "🎭 Trick badge waiting").waitForExistence(timeout: wait))
        app.buttons["👎 Keep out"].tap()
        XCTAssert(text(app, "✓ Sent: keep-out").waitForExistence(timeout: wait))
    }

    func testPresenterAllowsSpecial() {
        let app = launch(mode: "Presenter")
        XCTAssert(text(app, "⭐ Golden badge waiting").waitForExistence(timeout: wait))
        XCTAssert(text(app, expected).exists, "waiting card shows \(expected)")
        app.buttons["⭐ Allow golden"].tap()
        XCTAssert(text(app, "✓ Sent: allow-special").waitForExistence(timeout: wait))
    }

    func testPresenterResets() {
        let app = launch(mode: "Presenter")
        app.buttons["Reset the zoo"].tap()
        app.buttons["Reset"].tap()
        XCTAssert(text(app, "✓ Sent: reset").waitForExistence(timeout: wait))
    }

    private func label(_ app: XCUIElement, startingWith prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    func testShowsConnectedToTheMac() {
        let app = launch(mode: "Check in")
        let status = label(app, startingWith: "🟢 Connected")
        XCTAssert(status.waitForExistence(timeout: wait))
        XCTAssert(status.label.contains("· server "), "shows which server version: \(status.label)")
        XCTAssert(label(app, startingWith: "Built ").exists, "shows when this app was built")
    }

    /// The Mac is unreachable at first (the Playwright side brings it back after a while):
    /// the app says so, and Reconnect gets it back.
    func testReconnectsWhenTheMacComesBack() {
        let app = launch(mode: "Presenter")
        XCTAssert(label(app, startingWith: "🔴 Can't reach the Mac").waitForExistence(timeout: wait))
        let connected = label(app, startingWith: "🟢 Connected")
        let deadline = Date().addingTimeInterval(60)
        while !connected.exists && Date() < deadline {
            if app.buttons["Reconnect"].exists { app.buttons["Reconnect"].tap() }
            _ = connected.waitForExistence(timeout: 2)
        }
        XCTAssert(connected.exists, "connected again after Reconnect")
    }

    func testLogsCanBeCopied() {
        let app = launch(mode: "Check in")
        app.buttons["Logs"].tap()
        let line = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'app active'")).firstMatch
        XCTAssert(line.waitForExistence(timeout: wait), "the log shows what the app did")
        app.buttons["Copy"].tap()
        XCTAssert(app.buttons["Copied ✓"].waitForExistence(timeout: wait))
        XCTAssert(app.buttons["Share"].exists, "the log can be shared as a file")
    }

    /// Scanning a trick badge on Check in pauses scanning and offers the vote's buttons right there.
    func testCheckInDecidesTrick() {
        let app = launch(mode: "Check in")
        app.buttons["Start Scanning"].tap()
        XCTAssert(text(app, "🎭 Trick badge").waitForExistence(timeout: wait))
        XCTAssert(text(app, expected).exists, "shows \(expected)")
        app.buttons["👍 Let in"].tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.buttons["👍 Let in"])
        waitForExpectations(timeout: wait)
    }

    func testCheckInAllowsSpecial() {
        let app = launch(mode: "Check in")
        app.buttons["Start Scanning"].tap()
        XCTAssert(text(app, "⭐ Golden badge").waitForExistence(timeout: wait))
        XCTAssert(app.buttons["Not yet"].exists)
        app.buttons["👍 Let in"].tap()
        // It's on the list now; walking in takes one more scan.
        XCTAssert(label(app, startingWith: "✅ On the list").waitForExistence(timeout: wait))
    }

    /// Kept out a trick badge that has its real photo: one tap fixes the picture.
    func testCheckInFixesPicture() {
        let app = launch(mode: "Check in")
        app.buttons["Start Scanning"].tap()
        XCTAssert(text(app, "🎭 Trick badge").waitForExistence(timeout: wait))
        app.buttons["👎 Keep out"].tap()
        let fix = app.buttons["🔧 Fix the picture"]
        XCTAssert(fix.waitForExistence(timeout: wait), "after Keep out, the picture can be fixed")
        XCTAssert(app.buttons["Skip"].exists)
        fix.tap()
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: fix)
        waitForExpectations(timeout: wait)
    }

    func testRegisterMarksAway() {
        let app = launch(mode: "Register")
        app.buttons["📛 Scan a badge to register"].tap()
        XCTAssert(text(app, expected).waitForExistence(timeout: wait), "existing badge shows \(expected)")
        let away = app.switches["💤 Not here today"]
        XCTAssertEqual(away.value as? String, "0")
        away.switches.firstMatch.tap()
        let on = NSPredicate(format: "value == '1'")
        expectation(for: on, evaluatedWith: away)
        waitForExpectations(timeout: wait)
    }
}
