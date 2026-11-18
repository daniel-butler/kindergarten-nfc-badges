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
        XCTAssert(text(app, "⭐ Special badge waiting").waitForExistence(timeout: wait))
        XCTAssert(text(app, expected).exists, "waiting card shows \(expected)")
        app.buttons["⭐ Allow special"].tap()
        XCTAssert(text(app, "✓ Sent: allow-special").waitForExistence(timeout: wait))
    }

    func testPresenterResets() {
        let app = launch(mode: "Presenter")
        app.buttons["Reset the zoo"].tap()
        app.buttons["Reset"].tap()
        XCTAssert(text(app, "✓ Sent: reset").waitForExistence(timeout: wait))
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
