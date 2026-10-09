import Foundation
@main struct Check {
    static func main() throws {
        let clear = try JSONSerialization.jsonObject(with: JSONEncoder().encode(MemoryUpdateBody(expectedVersion: "v1", text: "draft", occurredAt: nil))) as! [String:Any]
        precondition(clear["expected_version"] as? String == "v1")
        precondition(clear["occurred_at"] is NSNull)
        let date = ISO8601DateFormatter().date(from: "2026-10-08T16:10:20Z")!
        let dated = try JSONSerialization.jsonObject(with: JSONEncoder().encode(MemoryUpdateBody(expectedVersion: "v2", text: "changed", occurredAt: date))) as! [String:Any]
        precondition(dated["occurred_at"] as? String == "2026-10-08T16:10:20.000Z")
        precondition(Set(dated.keys) == Set(["expected_version", "text", "occurred_at"]))
        let textOnly = try JSONSerialization.jsonObject(with: JSONEncoder().encode(MemoryUpdateBody(expectedVersion: "v3", text: "edit", occurredAt: date, includeOccurredAt: false))) as! [String:Any]
        precondition(Set(textOnly.keys) == Set(["expected_version", "text"]))
        let dateOnly = try JSONSerialization.jsonObject(with: JSONEncoder().encode(MemoryUpdateBody(expectedVersion: "v4", text: nil, occurredAt: nil))) as! [String:Any]
        precondition(Set(dateOnly.keys) == Set(["expected_version", "occurred_at"]))
        print("PASS")
    }
}
