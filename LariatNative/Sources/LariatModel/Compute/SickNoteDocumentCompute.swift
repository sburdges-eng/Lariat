import Foundation

/// Pure validation + path derivation for doctor's-note attachments
/// (design 2026-07-08-lariat-sick-note-docs §4). The `NSOpenPanel` restricts
/// pickable types; this validator re-checks the picked filename (defense in
/// depth, spec §9) and derives the stored relative path.
public enum SickNoteDocumentCompute {
    /// Lowercased extensions accepted for a doctor's-note attachment (spec §9).
    /// `jpe` is included because it conforms to `public.jpeg`, so the
    /// content-typed `NSOpenPanel` offers it — the two allowlists must agree or
    /// the panel presents a file the validator then rejects.
    public static let allowedExtensions: Set<String> = ["pdf", "jpg", "jpeg", "jpe", "png", "heic"]

    /// True when the filename's extension is in the allowlist (case-insensitive).
    public static func validate(filename: String) -> Bool {
        let ext = (filename as NSString).pathExtension.lowercased()
        return !ext.isEmpty && allowedExtensions.contains(ext)
    }

    /// Relative storage path under `data/uploads/` — UUID filename (never the
    /// original name, spec §7), lowercased extension.
    public static func storedPath(reportId: Int64, uuid: String, ext: String) -> String {
        "sick-notes/\(reportId)/\(uuid).\(ext.lowercased())"
    }

    /// Normalize a stored `file_path` and confirm it stays within the uploads
    /// root, returning the cleaned relative path (or nil if it escapes). The
    /// only writer of `file_path` is `storedPath` above, so a value that is
    /// absolute or climbs out with `..` indicates an out-of-band/tampered row;
    /// the view must not resolve it (defense-in-depth for the shared
    /// web-owned DB, mirroring `lib/recipePhotos.ts` containment — spec §7/§9).
    public static func safeUploadRelativePath(_ filePath: String) -> String? {
        let trimmed = filePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("/") else { return nil }

        var stack: [String] = []
        for component in trimmed.split(separator: "/", omittingEmptySubsequences: true) {
            switch component {
            case ".":
                continue
            case "..":
                // A `..` that would climb above the uploads root escapes it.
                guard !stack.isEmpty else { return nil }
                stack.removeLast()
            default:
                stack.append(String(component))
            }
        }
        guard !stack.isEmpty else { return nil }
        return stack.joined(separator: "/")
    }
}
