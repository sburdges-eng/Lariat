import Foundation
import CryptoKit

/// Builds and signs the cloud-bridge /v2/snapshot envelope, byte-identical to
/// lib/cloudBridgePush.ts. The signed body is CanonicalJSON of
/// {schema_version, table, location_id, batch_id, rows}; the signature is
/// HMAC-SHA256(secret, body ‖ idempotencyKey) as lowercase hex.
public enum CloudBridgeEnvelope {
    public static func canonicalBody(
        schemaVersion: Int,
        table: String,
        locationId: String,
        batchId: Int64,
        rows: [JSONValue]
    ) throws -> String {
        let body: JSONValue = .object([
            "schema_version": .int(Int64(schemaVersion)),
            "table": .string(table),
            "location_id": .string(locationId),
            "batch_id": .int(batchId),
            "rows": .array(rows),
        ])
        return try CanonicalJSON.encode(body)
    }

    /// HMAC-SHA256(secret, body ‖ idempotencyKey), lowercase hex. The two
    /// updates with no separator mirror lib/cloudBridgePush.ts::signRequest.
    public static func sign(secret: String, body: String, idempotencyKey: String) -> String {
        var mac = HMAC<SHA256>(key: SymmetricKey(data: Data(secret.utf8)))
        mac.update(data: Data(body.utf8))
        mac.update(data: Data(idempotencyKey.utf8))
        return mac.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
