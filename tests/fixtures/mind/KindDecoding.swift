import Foundation

@main
struct MindKindDecodingCheck {
    static func main() throws {
        for legacy in ["memory", "feel", "thought"] {
            let decoded = try JSONDecoder().decode(MindProductKind.self, from: Data("\"\(legacy)\"".utf8))
            precondition(decoded == .memory)
            let encoded = try JSONEncoder().encode(decoded)
            precondition(String(data: encoded, encoding: .utf8) == "\"memory\"")
        }
        precondition(MindProductKind.allCases == [.memory])
        do {
            _ = try JSONDecoder().decode(MindProductKind.self, from: Data("\"unknown\"".utf8))
            fatalError("Unknown kind must fail closed")
        } catch {}
        print("Mind kind decoding and encoding: PASS")
    }
}
