import Foundation
import NaturalLanguage
import Darwin

struct Candidate: Decodable {
    let stateId: String
    let text: String
}

struct Input: Decodable {
    let query: String
    let candidates: [Candidate]
    let language: String?
}

struct Score: Encodable {
    let stateId: String
    let score: Double
}

struct Output: Encodable {
    let language: String
    let revision: Int
    let scores: [Score]
}

enum HelperError: Error, CustomStringConvertible {
    case emptyQuery
    case unavailableEmbedding(String)

    var description: String {
        switch self {
        case .emptyQuery:
            return "query must not be empty"
        case .unavailableEmbedding(let language):
            return "sentence embedding unavailable for language \(language)"
        }
    }
}

func containsHan(_ value: String) -> Bool {
    value.range(of: #"\p{Script=Han}"#, options: .regularExpression) != nil
}

func preferredLanguage(requested: String?, query: String) -> NLLanguage {
    if let requested, !requested.isEmpty {
        return NLLanguage(rawValue: requested)
    }
    if let detected = NLLanguageRecognizer.dominantLanguage(for: query) {
        if detected == .traditionalChinese {
            return .simplifiedChinese
        }
        return detected
    }
    return containsHan(query) ? .simplifiedChinese : .english
}

func sentenceEmbedding(language requested: NLLanguage, query: String) throws -> (NLLanguage, NLEmbedding) {
    if let embedding = NLEmbedding.sentenceEmbedding(for: requested) {
        return (requested, embedding)
    }

    let fallback: NLLanguage = containsHan(query) ? .simplifiedChinese : .english
    if fallback != requested, let embedding = NLEmbedding.sentenceEmbedding(for: fallback) {
        return (fallback, embedding)
    }

    throw HelperError.unavailableEmbedding(requested.rawValue)
}

do {
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    let input = try JSONDecoder().decode(Input.self, from: inputData)
    let query = input.query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else {
        throw HelperError.emptyQuery
    }

    let requested = preferredLanguage(requested: input.language, query: query)
    let (language, embedding) = try sentenceEmbedding(language: requested, query: query)

    let scores = input.candidates.map { candidate -> Score in
        let text = candidate.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return Score(stateId: candidate.stateId, score: 0)
        }
        let distance = embedding.distance(
            between: query,
            and: text,
            distanceType: .cosine
        )
        let score = max(0.0, min(1.0, 1.0 - distance))
        return Score(stateId: candidate.stateId, score: score)
    }

    let output = Output(
        language: language.rawValue,
        revision: embedding.revision,
        scores: scores
    )
    let data = try JSONEncoder().encode(output)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    FileHandle.standardError.write(Data("LeileiOS embedding helper failed: \(error)\n".utf8))
    exit(1)
}
