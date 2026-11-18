import Foundation

struct ColorDTO: Codable, Equatable, Hashable {
    let hex: String
    let name: String
}

/// A card as the server stores it.
struct CardDTO: Codable, Equatable {
    var canonical_id: String
    var aliases: [String]
    var emoji: String
    var label: String
    var color: ColorDTO
    var trick: Bool
    var away: Bool
    var image: String?

    init(canonical_id: String, aliases: [String] = [], emoji: String, label: String, color: ColorDTO,
         trick: Bool = false, away: Bool = false, image: String? = nil) {
        self.canonical_id = canonical_id
        self.aliases = aliases
        self.emoji = emoji
        self.label = label
        self.color = color
        self.trick = trick
        self.away = away
        self.image = image
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        canonical_id = try c.decode(String.self, forKey: .canonical_id)
        aliases = try c.decodeIfPresent([String].self, forKey: .aliases) ?? []
        emoji = try c.decode(String.self, forKey: .emoji)
        label = try c.decode(String.self, forKey: .label)
        color = try c.decode(ColorDTO.self, forKey: .color)
        trick = try c.decodeIfPresent(Bool.self, forKey: .trick) ?? false
        away = try c.decodeIfPresent(Bool.self, forKey: .away) ?? false
        image = try c.decodeIfPresent(String.self, forKey: .image)
    }
}

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

    /// Same names and hex values as the swatches on the projector page.
    static let cardstockColors: [ColorDTO] = [
        ("Red", "#E53935"), ("Orange", "#FB8C00"), ("Yellow", "#FDD835"), ("Light Green", "#9CCC65"),
        ("Green", "#2E7D32"), ("Light Blue", "#81D4FA"), ("Blue", "#1E5BD8"), ("Purple", "#8E24AA"),
        ("Pink", "#F48FB1"), ("Brown", "#8D6E63"), ("Gray", "#9E9E9E"), ("White", "#FFFFFF"), ("Black", "#1A1A1A"),
    ].map { ColorDTO(hex: $0.1, name: $0.0) }

    private static let emojiByWord: [String: String] = [
        "panda": "🐼", "owl": "🦉", "bee": "🐝", "frog": "🐸", "puppy": "🐶", "dog": "🐶",
        "budgie": "🐦", "parakeet": "🐦", "bird": "🐦", "bunny": "🐰", "rabbit": "🐰", "cat": "🐱",
        "kitty": "🐱", "fox": "🦊", "lion": "🦁", "tiger": "🐯", "bear": "🐻", "penguin": "🐧",
        "monkey": "🐵", "unicorn": "🦄", "turtle": "🐢", "koala": "🐨", "elephant": "🐘", "giraffe": "🦒",
        "pig": "🐷", "cow": "🐮", "duck": "🦆", "chick": "🐥", "chicken": "🐔", "mouse": "🐭",
        "hamster": "🐹", "dinosaur": "🦖", "dino": "🦖", "octopus": "🐙", "whale": "🐳", "dolphin": "🐬",
        "fish": "🐠", "butterfly": "🦋", "ladybug": "🐞", "snail": "🐌", "hedgehog": "🦔", "sloth": "🦥",
        "otter": "🦦", "zebra": "🦓", "horse": "🐴", "sheep": "🐑", "lamb": "🐑", "deer": "🦌",
    ]

    /// Fallback emoji for a sticker the presenter named (any word of the name can match).
    static func emoji(forName name: String) -> String {
        let words = name.lowercased().split { !$0.isLetter }.map(String.init)
        return words.lazy.compactMap { emojiByWord[$0] }.first ?? "🐾"
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

    private struct ResolveDTO: Decodable {
        let canonical_id: String
        let card: CardDTO?
    }

    private static func send(_ request: URLRequest) async -> Result<Data, Error> {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                return .failure(Failure.server(status, String(data: data, encoding: .utf8) ?? ""))
            }
            return .success(data)
        } catch {
            return .failure(error)
        }
    }

    private static func decoded<T: Decodable>(_ result: Result<Data, Error>, as type: T.Type) -> Result<T, Error> {
        result.flatMap { data in Result { try JSONDecoder().decode(T.self, from: data) } }
    }

    /// Which card is this badge? Uses the server's matching, without counting as a tap.
    static func resolve(id: String, server: String) async -> Result<(canonicalID: String, card: CardDTO?), Error> {
        let query = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        guard let url = endpoint(server: server, path: "/api/cards/resolve?id=\(query)") else {
            return .failure(Failure.badURL(server))
        }
        return decoded(await send(URLRequest(url: url, timeoutInterval: 4)), as: ResolveDTO.self)
            .map { ($0.canonical_id, $0.card) }
    }

    /// Create or replace one card.
    static func upsert(_ card: CardDTO, server: String) async -> Result<CardDTO, Error> {
        guard let url = endpoint(server: server, path: "/api/cards") else { return .failure(Failure.badURL(server)) }
        var request = URLRequest(url: url, timeoutInterval: 6)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(card)
        return decoded(await send(request), as: CardDTO.self)
    }

    /// Store the sticker cutout (PNG) for a card.
    static func uploadImage(_ png: Data, id: String, server: String) async -> Result<CardDTO, Error> {
        guard let url = endpoint(server: server, path: "/api/cards/\(id)/image") else {
            return .failure(Failure.badURL(server))
        }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "PUT"
        request.setValue("image/png", forHTTPHeaderField: "Content-Type")
        request.httpBody = png
        return decoded(await send(request), as: CardDTO.self)
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
