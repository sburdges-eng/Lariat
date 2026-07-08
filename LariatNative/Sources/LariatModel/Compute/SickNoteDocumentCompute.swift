import Foundation

/// Pure validation + path derivation for doctor's-note attachments
/// (design 2026-07-08-lariat-sick-note-docs §4). The `NSOpenPanel` restricts
/// pickable types; this validator re-checks the picked filename (defense in
/// depth, spec §9) and derives the stored relative path.
public enum SickNoteDocumentCompute {
    /// Lowercased extensions accepted for a doctor's-note attachment (spec §9).
    public static let allowedExtensions: Set<String> = ["pdf", "jpg", "jpeg", "png", "heic"]

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
}
