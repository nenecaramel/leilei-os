import Foundation
import Security

protocol AccessTokenStore: Sendable {
    func read() throws -> String?
    func write(_ token: String) throws
    func clear() throws
}

struct KeychainAccessTokenStore: AccessTokenStore {
    private let service = "com.leileios.auth"
    private let account = "access-token"

    func read() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess else {
            throw KeychainError(status: status)
        }
        guard
            let data = item as? Data,
            let token = String(data: data, encoding: .utf8)
        else {
            throw KeychainError.invalidTokenData
        }
        return token
    }

    func write(_ token: String) throws {
        let data = Data(token.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let status = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var insert = baseQuery
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] =
                kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

            let insertStatus = SecItemAdd(insert as CFDictionary, nil)
            guard insertStatus == errSecSuccess else {
                throw KeychainError(status: insertStatus)
            }
            return
        }

        guard status == errSecSuccess else {
            throw KeychainError(status: status)
        }
    }

    func clear() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

enum KeychainError: LocalizedError {
    case osStatus(OSStatus)
    case invalidTokenData

    init(status: OSStatus) {
        self = .osStatus(status)
    }

    var errorDescription: String? {
        switch self {
        case .osStatus(let status):
            return "Keychain operation failed (OSStatus \(status))."
        case .invalidTokenData:
            return "Stored access token is not valid UTF-8."
        }
    }
}
