// Mac-side checks for TapClient (no phone needed):
//   swiftc ClassroomZoo/TapClient.swift ClassroomZoo/StickerEdges.swift Tests/*.swift -o /tmp/tapcheck && /tmp/tapcheck
// With BADGE_SERVER=http://localhost:8080 set, it also POSTs a real tap to a running server.
import Foundation

var failures = 0
func check(_ condition: Bool, _ message: String) {
    if !condition {
        failures += 1
        print("FAIL: \(message)")
    }
}

runStickerEdgesChecks()

check(TapClient.hexID(Data([0x04, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6])) == "04A1B2C3D4E5F6", "hexID is uppercase, unseparated")
check(TapClient.hexID(Data([0x00, 0x0F])) == "000F", "hexID keeps leading zeros")

check(TapClient.endpoint(server: "172.20.10.2:8080", path: "/tap")?.absoluteString == "http://172.20.10.2:8080/tap", "adds http://")
check(TapClient.endpoint(server: " http://mac.local:8080/ ", path: "/tap")?.absoluteString == "http://mac.local:8080/tap", "trims spaces and slash")
check(TapClient.endpoint(server: "", path: "/tap") == nil, "empty server is nil")

let logBody = try! JSONSerialization.jsonObject(with: TapClient.logBody(lines: ["10:15:59.123 app active"])) as! [String: Any]
check(logBody["source"] as? String == "phone" && logBody["lines"] as? [String] == ["10:15:59.123 app active"],
      "log body matches the server's /api/log")

let body = try! JSONSerialization.jsonObject(with: TapClient.tapBody(id: "04A1B2C3D4E5F6")) as! [String: String]
check(body == ["id": "04A1B2C3D4E5F6", "source": "phone"], "tap body matches the server API")

let known = ##"{"raw_id":"x","canonical_id":"04A1","source":"phone","card":{"canonical_id":"04A1","aliases":[],"emoji":"🐧","label":"Penguin","color":{"hex":"#1E5BD8","name":"Blue"},"trick":false},"ts":1}"##
check(TapClient.summary(of: Data(known.utf8)) == "🐧 Penguin", "summary of known card")
let unknown = #"{"raw_id":"x","canonical_id":"DEADBEEF","source":"phone","card":null,"ts":1}"#
check(TapClient.summary(of: Data(unknown.utf8)) == "❓ Unknown badge DEADBEEF", "summary of unknown card")

check(TapClient.emoji(forName: "panda") == "🐼", "emoji for panda")
check(TapClient.emoji(forName: "Fairy Frog") == "🐸", "emoji matches any word")
check(TapClient.emoji(forName: "Budgie") == "🐦", "emoji for budgie")
check(TapClient.emoji(forName: "Zork") == "🐾", "emoji fallback")

check(TapClient.cardstockColors.count == 13, "13 cardstock colors")
check(TapClient.cardstockColors.contains(ColorDTO(hex: "#1E5BD8", name: "Blue")), "Blue matches the page")

let minimal = ##"{"canonical_id":"04A1","aliases":[],"emoji":"🐼","label":"Panda","color":{"hex":"#1E5BD8","name":"Blue"}}"##
let decoded = try! JSONDecoder().decode(CardDTO.self, from: Data(minimal.utf8))
check(decoded.role == "normal" && decoded.away == false && decoded.image == nil, "CardDTO defaults")
let full = ##"{"canonical_id":"04A1","aliases":["X"],"emoji":"🐼","label":"Panda","color":{"hex":"#1E5BD8","name":"Blue"},"role":"special","allowed":true,"away":true,"image":"/images/04A1.png?v=1"}"##
let decodedFull = try! JSONDecoder().decode(CardDTO.self, from: Data(full.utf8))
check(decodedFull.role == "special" && decodedFull.allowed && decodedFull.away && decodedFull.image == "/images/04A1.png?v=1", "CardDTO full decode")
let legacy = ##"{"canonical_id":"04A1","emoji":"🐼","label":"Panda","color":{"hex":"#1E5BD8","name":"Blue"},"trick":true}"##
check((try? JSONDecoder().decode(CardDTO.self, from: Data(legacy.utf8)))?.role == "trick", "legacy trick decodes as role trick")
let encoded = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(decodedFull)) as! [String: Any]
check(encoded["role"] as? String == "special" && encoded["away"] as? Bool == true && encoded["trick"] == nil, "CardDTO encodes role and away")

let presenterJSON = ##"{"waiting":{"kind":"trick","card":{"canonical_id":"04A1","aliases":[],"emoji":"🦊","label":"Fox","color":{"hex":"#E53935","name":"Red"},"role":"trick"},"raw_id":"04a1","ts":1},"last_unknown":{"raw_id":"DEADBEEF","ts":2}}"##
let presenter = try? JSONDecoder().decode(PresenterDTO.self, from: Data(presenterJSON.utf8))
check(presenter?.waiting?.kind == "trick" && presenter?.waiting?.card.label == "Fox" && presenter?.last_unknown?.raw_id == "DEADBEEF", "PresenterDTO decode")
let emptyPresenter = try? JSONDecoder().decode(PresenterDTO.self, from: Data(#"{"waiting":null,"last_unknown":null}"#.utf8))
check(emptyPresenter != nil && emptyPresenter?.waiting == nil, "PresenterDTO decodes nulls")
check(TapClient.shortcuts.contains { $0.key == "⌥A" && $0.action.contains("Allow") }, "shortcuts list ⌥A Allow special")
check(TapClient.shortcuts.contains { $0.key == "⌥R ⌥R" }, "shortcuts list the reset double press")
check(TapClient.shortcuts.contains { $0.key == "⌥Y" && $0.action.hasPrefix("Let in") }, "⌥Y says Let in")
check(TapClient.shortcuts.contains { $0.key == "⌥N" && $0.action.hasPrefix("Keep out") }, "⌥N says Keep out")

if let server = ProcessInfo.processInfo.environment["BADGE_SERVER"] {
    let registered = DispatchSemaphore(value: 0)
    Task {
        let card = CardDTO(canonical_id: "04C0FFEE123456", emoji: "🐼", label: "Panda", color: ColorDTO(hex: "#1E5BD8", name: "Blue"), role: "trick")
        switch await TapClient.upsert(card, server: server) {
        case .success(let saved): check(saved.canonical_id == "04C0FFEE123456", "upsert returns the card")
        case .failure(let error): check(false, "upsert failed: \(error.localizedDescription)")
        }
        switch await TapClient.resolve(id: "563412EE", server: server) {
        case .success(let r): check(r.card?.label == "Panda", "resolve finds the card from a reader-form id")
        case .failure(let error): check(false, "resolve failed: \(error.localizedDescription)")
        }
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")!
        switch await TapClient.uploadImage(png, id: "04C0FFEE123456", server: server) {
        case .success(let c): check(c.image?.hasPrefix("/images/04C0FFEE123456.png?v=") == true, "upload sets image")
        case .failure(let error): check(false, "upload failed: \(error.localizedDescription)")
        }
        if case .failure(let error) = await TapClient.command("party", server: server) {
            check(false, "party command failed: \(error.localizedDescription)")
        }
        if case .success = await TapClient.command("nope", server: server) {
            check(false, "unknown command should fail")
        }
        _ = await TapClient.post(id: "04C0FFEE123456", server: server)
        switch await TapClient.presenter(server: server) {
        case .success(let p): check(p.waiting?.kind == "trick" && p.waiting?.card.label == "Panda", "presenter shows the waiting trick")
        case .failure(let error): check(false, "presenter failed: \(error.localizedDescription)")
        }
        registered.signal()
    }
    registered.wait()
}

if let server = ProcessInfo.processInfo.environment["BADGE_SERVER"] {
    let done = DispatchSemaphore(value: 0)
    Task {
        if case .failure(let error) = await TapClient.ping(server: server) {
            check(false, "ping() against \(server): \(error.localizedDescription)")
        }
        if case .success = await TapClient.ping(server: "http://localhost:9") {
            check(false, "ping() to a closed port should fail")
        }
        switch await TapClient.post(id: "04A1B2C3D4E5F6", server: server) {
        case .success(let summary): print("live tap → \(summary)")
        case .failure(let error): check(false, "live tap failed: \(error.localizedDescription)")
        }
        done.signal()
    }
    done.wait()
}

print(failures == 0 ? "TapClient checks passed" : "\(failures) TapClient check(s) failed")
exit(failures == 0 ? 0 : 1)
