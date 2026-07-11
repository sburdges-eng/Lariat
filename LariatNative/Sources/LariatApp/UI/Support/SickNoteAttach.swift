#if canImport(AppKit)
import AppKit
import Foundation
import UniformTypeIdentifiers
import LariatModel
import LariatDB

/// `NSOpenPanel` + copy step for doctor's-note attachments (design
/// 2026-07-08-lariat-sick-note-docs §4). The panel restricts pickable types to
/// the allowlist; the picked filename is re-checked by the pure validator
/// (defense in depth, spec §9). The file is copied to
/// `<dataDir>/uploads/sick-notes/<report_id>/<uuid>.<ext>` — UUID filename,
/// never the original name (spec §7).
enum SickNoteAttach {
    struct Picked {
        /// Stored relative path (relative to `data/uploads/`).
        let filePath: String
        /// The picked file's name — display-only metadata.
        let originalFilename: String
        /// Absolute destination — kept so a failed DB insert can clean up.
        let destination: URL
    }

    /// Present the open panel and copy the picked file into the uploads tree.
    /// Returns nil when the operator cancels. Throws on a rejected type or a
    /// failed copy.
    static func pickAndCopy(reportId: Int64, dataDir: URL) throws -> Picked? {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = allowedContentTypes
        panel.message = "Choose the doctor's note or clearance paperwork (PDF, JPEG, PNG, or HEIC)."
        panel.prompt = "Attach"
        guard panel.runModal() == .OK, let src = panel.url else { return nil }
        return try copyIn(pickedURL: src, reportId: reportId, dataDir: dataDir)
    }

    /// The copy step, separated from the panel so the validation/copy path has
    /// no UI dependency (the panel itself cannot run headless).
    static func copyIn(pickedURL src: URL, reportId: Int64, dataDir: URL) throws -> Picked {
        let name = src.lastPathComponent
        guard SickNoteDocumentCompute.validate(filename: name) else {
            throw SickNoteAttachError.unsupportedType(name)
        }
        let ext = (name as NSString).pathExtension

        // Size gate BEFORE reading the whole file into memory.
        if let size = try FileManager.default.attributesOfItem(atPath: src.path)[.size] as? Int,
           !SickNoteContentValidator.withinSizeLimit(size) {
            throw SickNoteAttachError.tooLarge
        }
        let plaintext = try Data(contentsOf: src)
        guard SickNoteContentValidator.matches(bytes: plaintext, ext: ext) else {
            throw SickNoteAttachError.contentMismatch
        }

        let rel = SickNoteDocumentCompute.storedPath(reportId: reportId, uuid: UUID().uuidString, ext: ext)
        let dest = dataDir.appendingPathComponent("uploads").appendingPathComponent(rel)
        try FileManager.default.createDirectory(
            at: dest.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let mediaKey = try SickNoteKeyStore().loadOrCreate(dataDir: dataDir)
        guard let keyId = mediaKey.keyIdData, let symKey = mediaKey.symmetricKey else {
            throw SickNoteAttachError.encryptionUnavailable
        }
        let sealed = try SickNoteCrypto.seal(plaintext, key: symKey, keyId: keyId, filePath: rel)
        try sealed.write(to: dest, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: dest.path)

        return Picked(filePath: rel, originalFilename: name, destination: dest)
    }

    /// Panel-level allowlist (spec §9): PDF + JPEG + PNG + HEIC.
    static var allowedContentTypes: [UTType] {
        var types: [UTType] = [.pdf, .jpeg, .png]
        if let heic = UTType(filenameExtension: "heic") { types.append(heic) }
        return types
    }
}

enum SickNoteAttachError: LocalizedError {
    case unsupportedType(String)
    case tooLarge
    case contentMismatch
    case encryptionUnavailable

    var errorDescription: String? {
        switch self {
        // The picked filename is PHI-adjacent and these messages can render on the
        // shared board — describe the problem in kitchen-native terms, never the
        // file's name (docs/UI_COPY_RULES.md: no "validation failed"/"authenticate").
        case .unsupportedType:
            return "That file type isn't allowed — attach a PDF, JPEG, PNG, or HEIC."
        case .tooLarge:
            return "That file is too big to attach."
        case .contentMismatch:
            return "That file doesn't look like a real photo or PDF."
        case .encryptionUnavailable:
            return "Couldn't lock the file safely — please try again."
        }
    }
}
#endif
