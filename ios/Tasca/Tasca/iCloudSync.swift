import Foundation

/// Reads and writes tasca.json via a user-picked iCloud Drive file.
///
/// The user runs `link` once to pick the file with the native iOS file picker.
/// A security-scoped bookmark is stored in UserDefaults and resolved on every
/// subsequent read/write — no hidden app containers involved.
class iCloudSync {

    private let bookmarkKey = "tascaFileBookmark"

    var isLinked: Bool { resolveURL() != nil }

    // MARK: - Bookmark

    /// Stores a security-scoped bookmark for the user-picked URL.
    func link(to url: URL) {
        _ = url.startAccessingSecurityScopedResource()
        defer { url.stopAccessingSecurityScopedResource() }
        do {
            let data = try url.bookmarkData(
                options: .minimalBookmark,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            UserDefaults.standard.set(data, forKey: bookmarkKey)
            print("[iCloudSync] Linked to:", url.lastPathComponent)
        } catch {
            print("[iCloudSync] Failed to create bookmark:", error)
        }
    }

    private func resolveURL() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var isStale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: .withoutUI,
            relativeTo: nil,
            bookmarkDataIsStale: &isStale
        ) else { return nil }
        if isStale,
           let fresh = try? url.bookmarkData(
               options: .minimalBookmark,
               includingResourceValuesForKeys: nil,
               relativeTo: nil
           ) {
            UserDefaults.standard.set(fresh, forKey: bookmarkKey)
        }
        return url
    }

    // MARK: - Read

    func read() async -> String? {
        guard let url = resolveURL() else {
            print("[iCloudSync] No file linked"); return nil
        }
        _ = url.startAccessingSecurityScopedResource()
        defer { url.stopAccessingSecurityScopedResource() }

        try? FileManager.default.startDownloadingUbiquitousItem(at: url)

        for _ in 0..<10 {
            if let content = try? String(contentsOf: url, encoding: .utf8), !content.isEmpty {
                print("[iCloudSync] Read \(content.count) bytes")
                return content
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        print("[iCloudSync] Read timed out")
        return nil
    }

    // MARK: - Write

    func write(_ json: String) {
        guard let url = resolveURL() else { return }
        Task.detached {
            _ = url.startAccessingSecurityScopedResource()
            defer { url.stopAccessingSecurityScopedResource() }
            do {
                try json.write(to: url, atomically: true, encoding: .utf8)
                print("[iCloudSync] Wrote \(json.count) bytes")
            } catch {
                print("[iCloudSync] Write failed:", error)
            }
        }
    }
}
