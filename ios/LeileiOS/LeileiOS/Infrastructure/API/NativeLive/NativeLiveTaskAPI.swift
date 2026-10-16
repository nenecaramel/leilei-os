import Foundation

extension LeileiAPIClient {
    // One durable request ID, including after a lost HTTP response. Never resend
    // a Stop because the result was uncertain; a fresh list observes SDK state.
    func nativeLiveTaskControl(
        prepareID: String,
        action: String,
        task: NativeLiveTaskSnapshot? = nil,
        generationID: String? = nil
    ) async throws -> NativeLiveTaskReceipt {
        let controlID = UUID()
        var payload: [String: NativeLiveJSONValue] = ["action": .string(action)]
        if let task, let generationID {
            payload["taskId"] = .string(task.taskId)
            payload["handle"] = .string(task.handle)
            payload["generationId"] = .string(generationID)
        }
        do {
            let _: NativeLiveRuntimeControlCreateEnvelope = try await request(
                path: "/api/v1/native-live/turns/\(prepareID)/controls",
                method: "POST",
                body: JSONEncoder().encode(NativeLiveRuntimeControlCreateBody(
                    controlID: controlID.uuidString.lowercased(), kind: "task", payload: payload
                )),
                authenticated: true
            )
        } catch {
            try Task.checkCancellation()
            // The POST may have committed. Poll its exact ID; do not repeat it.
        }
        let deadline = ContinuousClock.now.advanced(by: .seconds(12))
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            let envelope: NativeLiveTaskControlEnvelope = try await request(
                path: "/api/v1/native-live/turns/\(prepareID)/task-controls/\(controlID.uuidString.lowercased())",
                authenticated: true
            )
            let control = envelope.data
            if control.status == "applied", let receipt = control.receipt {
                return try JSONDecoder().decode(
                    NativeLiveTaskReceipt.self,
                    from: JSONEncoder().encode(receipt)
                )
            }
            if control.status == "failed" { throw LeileiAPIError.invalidResponse }
            try await Task.sleep(for: .milliseconds(400))
        }
        throw LeileiAPIError.invalidResponse
    }
}

struct NativeLiveTaskControlEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLiveRuntimeControlSnapshot
}
