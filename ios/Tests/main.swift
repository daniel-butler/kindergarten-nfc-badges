// Mac-side checks for TapClient (no phone needed):
//   swiftc ClassroomZoo/TapClient.swift Tests/main.swift -o /tmp/tapcheck && /tmp/tapcheck
// With BADGE_SERVER=http://localhost:8080 set, it also POSTs a real tap to a running server.
import Foundation

var failures = 0
func check(_ condition: Bool, _ message: String) {
    if !condition {
        failures += 1
        print("FAIL: \(message)")
    }
}

check(TapClient.hexID(Data([0x04, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6])) == "04A1B2C3D4E5F6", "hexID is uppercase, unseparated")
check(TapClient.hexID(Data([0x00, 0x0F])) == "000F", "hexID keeps leading zeros")

check(TapClient.endpoint(server: "172.20.10.2:8080", path: "/tap")?.absoluteString == "http://172.20.10.2:8080/tap", "adds http://")
check(TapClient.endpoint(server: " http://mac.local:8080/ ", path: "/tap")?.absoluteString == "http://mac.local:8080/tap", "trims spaces and slash")
check(TapClient.endpoint(server: "", path: "/tap") == nil, "empty server is nil")

let body = try! JSONSerialization.jsonObject(with: TapClient.tapBody(id: "04A1B2C3D4E5F6")) as! [String: String]
check(body == ["id": "04A1B2C3D4E5F6", "source": "phone"], "tap body matches the server API")

let known = ##"{"raw_id":"x","canonical_id":"04A1","source":"phone","card":{"canonical_id":"04A1","aliases":[],"emoji":"🐧","label":"Penguin","color":{"hex":"#1E5BD8","name":"Blue"},"trick":false},"ts":1}"##
check(TapClient.summary(of: Data(known.utf8)) == "🐧 Penguin", "summary of known card")
let unknown = #"{"raw_id":"x","canonical_id":"DEADBEEF","source":"phone","card":null,"ts":1}"#
check(TapClient.summary(of: Data(unknown.utf8)) == "❓ Unknown badge DEADBEEF", "summary of unknown card")

if let server = ProcessInfo.processInfo.environment["BADGE_SERVER"] {
    let done = DispatchSemaphore(value: 0)
    Task {
        let status = await TapClient.check(server: server)
        check(status.hasPrefix("✅ Connected"), "check() against \(server): \(status)")
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
