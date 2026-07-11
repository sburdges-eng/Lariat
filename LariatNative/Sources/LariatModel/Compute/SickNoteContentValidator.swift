import Foundation

/// Pure content validation for sick-note uploads (audit P0-6). Runs on plaintext
/// bytes BEFORE encryption. The App layer reads the leading bytes + file size and
/// calls in; keeping this pure makes it LariatModelTests-testable.
public enum SickNoteContentValidator {
    public static let maxDocumentBytes = 25 * 1024 * 1024

    public enum Kind: Equatable { case pdf, jpeg, png, heic }

    public static func withinSizeLimit(_ byteCount: Int) -> Bool { byteCount <= maxDocumentBytes }

    public static func sniff(_ bytes: Data) -> Kind? {
        let b = [UInt8](bytes.prefix(16))
        if b.count >= 5, b[0]==0x25, b[1]==0x50, b[2]==0x44, b[3]==0x46, b[4]==0x2D { return .pdf }
        if b.count >= 3, b[0]==0xFF, b[1]==0xD8, b[2]==0xFF { return .jpeg }
        if b.count >= 8, b[0]==0x89, b[1]==0x50, b[2]==0x4E, b[3]==0x47,
           b[4]==0x0D, b[5]==0x0A, b[6]==0x1A, b[7]==0x0A { return .png }
        if b.count >= 12, b[4]==0x66, b[5]==0x74, b[6]==0x79, b[7]==0x70 { // 'ftyp' box
            let brand = String(bytes: b[8..<12], encoding: .ascii) ?? ""
            if ["heic","heix","hevc","hevx","mif1","msf1"].contains(brand) { return .heic }
        }
        return nil
    }

    public static func matches(bytes: Data, ext: String) -> Bool {
        guard let kind = sniff(bytes) else { return false }
        switch kind {
        case .pdf:  return ext.lowercased() == "pdf"
        case .jpeg: return ["jpg","jpeg","jpe"].contains(ext.lowercased())
        case .png:  return ext.lowercased() == "png"
        case .heic: return ext.lowercased() == "heic"
        }
    }
}
