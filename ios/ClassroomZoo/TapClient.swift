import Foundation

/// Talks to the badge server. Foundation-only so it can be checked on a Mac without a phone.
enum TapClient {
    enum Failure: LocalizedError {
        case badURL(String)
        case server(Int, String)

        var errorDescription: String? {
            switch self {
            case .badURL(let url): return "Bad server URL: \(url)"
            case .server(let status, let body): return "Server said \(status): \(body)"
            }
        }
    }

    struct TapResponse: Decodable {
        struct Card: Decodable {
            let emoji: String
            let label: String
        }

        let canonical_id: String
        let card: Card?
    }

    static func hexID(_ data: Data) -> String {
        data.map { String(format: "%02X", $0) }.joined()
    }

    /// Accepts "172.20.10.2:8080", "http://172.20.10.2:8080/", etc.
    static func endpoint(server: String, path: String) -> URL? {
        var base = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !base.isEmpty else { return nil }
        if !base.contains("://") { base = "http://" + base }
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: base + path)
    }

    static func tapBody(id: String) -> Data {
        try! JSONSerialization.data(withJSONObject: ["id": id, "source": "phone"])
    }

    /// Short human summary of a tap response: "🐧 Penguin" or "❓ Unknown badge …".
    static func summary(of data: Data) -> String {
        guard let response = try? JSONDecoder().decode(TapResponse.self, from: data) else {
            return String(data: data, encoding: .utf8) ?? "Unreadable response"
        }
        if let card = response.card { return "\(card.emoji) \(card.label)" }
        return "❓ Unknown badge \(response.canonical_id)"
    }

    static func post(id: String, server: String) async -> Result<String, Error> {
        guard let url = endpoint(server: server, path: "/tap") else { return .failure(Failure.badURL(server)) }
        var request = URLRequest(url: url, timeoutInterval: 4)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = tapBody(id: id)
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                return .failure(Failure.server(status, String(data: data, encoding: .utf8) ?? ""))
            }
            return .success(summary(of: data))
        } catch {
            return .failure(error)
        }
    }

    /// GET /api/cards; returns a one-line status for the "Test connection" button.
    static func check(server: String) async -> String {
        guard let url = endpoint(server: server, path: "/api/cards") else { return "⚠️ Bad server URL" }
        do {
            let (data, _) = try await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 4))
            let cards = (try? JSONSerialization.jsonObject(with: data)) as? [Any]
            return cards.map { "✅ Connected: \($0.count) badges" } ?? "⚠️ Unexpected reply"
        } catch {
            return "⚠️ \(error.localizedDescription)"
        }
    }
}
