import Foundation

struct NativeLiveStructuredJSON: Equatable, Sendable {
    struct Field: Equatable, Sendable { let key: String; let value: NativeLiveJSONValue }
    let value: NativeLiveJSONValue
    let truncated: Bool
    var fields: [Field] { (value.objectValue ?? [:]).keys.sorted().map { .init(key:$0,value:value.objectValue![$0]!) } }
    var copyJSON: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys,.prettyPrinted,.withoutEscapingSlashes]
        return (try? encoder.encode(value)).flatMap { String(data:$0,encoding:.utf8) } ?? "null"
    }
    init(_ input:NativeLiveJSONValue) {
        var nodes=256, chars=8000, clipped=false
        func bound(_ value:NativeLiveJSONValue,_ depth:Int) -> NativeLiveJSONValue {
            nodes -= 1
            guard depth <= 6, nodes >= 0, chars > 0 else { clipped=true; return .string("[omitted: presentation bounds]") }
            switch value {
            case .object(let object):
                var output:[String:NativeLiveJSONValue]=[:]
                if object.count > 48 { clipped=true }
                for key in object.keys.sorted().prefix(48) {
                    guard nodes > 0, chars > 0 else { clipped=true; break }
                    let safe=String(key.prefix(128)); chars -= safe.count
                    if safe != key { clipped=true }
                    // Keep collision handling deterministic without silently overwriting values.
                    var name=safe
                    while output[name] != nil { name += ":" }
                    output[name]=bound(object[key]!,depth+1)
                }
                return .object(output)
            case .array(let values):
                let count=min(32,max(0,nodes))
                if values.count > count { clipped=true }
                return .array(values.prefix(count).map { bound($0,depth+1) })
            case .string(let text):
                let safe=String(text.prefix(min(8000,max(0,chars)))); chars -= safe.count
                if safe != text { clipped=true }; return .string(safe)
            case .number(let n): return n.isFinite ? .number(n) : .null
            default: return value
            }
        }
        value=bound(input,0); truncated=clipped
    }
}
