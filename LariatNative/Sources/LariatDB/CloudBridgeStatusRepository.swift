import Foundation
import GRDB

/// The merged status the web cloud-bridge surfaces expose (A5.4 option B,
/// ratified 2026-07-03 — native gets a READ-ONLY status view; the transport
/// stays on the Next.js edge).
///
/// Field provenance:
///   - `queuedDepth` / `deadLetterTotal` — the board's status strip
///     ("Waiting to send" / "Stuck"): `lib/cloudBridgeQueue.ts` `depth()` +
///     `deadLetterDepth()`, served as `queued_depth` / `dead_letter_depth_total`
///     by GET /api/cloud-bridge/dead-letters and the /management/cloud-bridge
///     server first paint. Neither count is location-scoped on the web.
///   - `lastPushAt` / `lastPullAt` / `lastError` — GET /api/cloud-bridge/status
///     → `CloudBridgeImpl.status()`, which is a stub returning nulls
///     (`lib/cloudBridge.ts`; oracle `tests/js/test-cloud-bridge-stub.mjs`).
///     Nothing persists a successful-push timestamp anywhere — `ack()` DELETEs
///     the pushed row — so these are honestly "no sync data recorded", not
///     a native invention of health the web cannot show either.
public struct CloudBridgeStatus: Equatable, Sendable {
    /// Batches queued and available to claim (dead_letter = 0, claimed_at NULL).
    public let queuedDepth: Int
    /// Dead-lettered batches across ALL locations (dead_letter = 1) — parity
    /// with the web board's `dead_letter_depth_total`.
    public let deadLetterTotal: Int
    /// Always nil today — web `bridge.status()` stub (no persisted last-sync).
    public let lastPushAt: String?
    /// Always nil today — web `bridge.status()` stub.
    public let lastPullAt: String?
    /// Always nil today — web `bridge.status()` stub.
    public let lastError: String?

    public init(
        queuedDepth: Int,
        deadLetterTotal: Int,
        lastPushAt: String? = nil,
        lastPullAt: String? = nil,
        lastError: String? = nil
    ) {
        self.queuedDepth = queuedDepth
        self.deadLetterTotal = deadLetterTotal
        self.lastPushAt = lastPushAt
        self.lastPullAt = lastPullAt
        self.lastError = lastError
    }
}

/// READ-ONLY repository for the CloudBridge status view (`manager.cloudBridge`).
///
/// Mirrors ONLY the read paths behind the web status card: the two COUNTs from
/// `cloud_bridge_outbox` (`lib/cloudBridgeQueue.ts::depth/deadLetterDepth`) and
/// the configured probe (`lib/cloudBridge.ts::isCloudBridgeConfigured`). It
/// ports NONE of the transport: no peer crypto, no sync-since, no discovery,
/// no dead-letter requeue/drop writes — those stay on the Next.js edge per the
/// ratified A5.4 decision (see docs/superpowers/specs/lariat-native-edge-blockers.md).
///
/// NOT location-scoped by design: the web `depth()`/`deadLetterDepth()` queries
/// have no `location_id` filter (only the triage LIST is scoped, and the list
/// stays on the edge with its actions). No writes, no audit rows.
public struct CloudBridgeStatusRepository {
    let database: LariatDatabase

    public init(database: LariatDatabase) {
        self.database = database
    }

    /// Load the current queue status. Throws if `cloud_bridge_outbox` is
    /// unreadable (e.g. schema not yet created by the web app) — callers mirror
    /// the web page's degrade path (`initialError`) rather than showing zeros.
    public func load() async throws -> CloudBridgeStatus {
        try await database.pool.read { db in
            // lib/cloudBridgeQueue.ts::depth() — "available to claim".
            let queued = try Int.fetchOne(
                db,
                sql: """
                    SELECT COUNT(*) AS n
                      FROM cloud_bridge_outbox
                     WHERE dead_letter = 0
                       AND claimed_at IS NULL
                    """
            ) ?? 0

            // lib/cloudBridgeQueue.ts::deadLetterDepth() — manual triage required.
            let dead = try Int.fetchOne(
                db,
                sql: """
                    SELECT COUNT(*) AS n
                      FROM cloud_bridge_outbox
                     WHERE dead_letter = 1
                    """
            ) ?? 0

            // lastPushAt/lastPullAt/lastError: web status() stub — always nil.
            return CloudBridgeStatus(queuedDepth: queued, deadLetterTotal: dead)
        }
    }

    /// Parity with `lib/cloudBridge.ts::isCloudBridgeConfigured()`: true only
    /// when BOTH env vars are present and non-empty (JS `Boolean(secret && baseUrl)`
    /// — an empty string is falsy).
    public static func isConfigured(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
        let baseUrl = environment["LARIAT_CLOUD_BRIDGE_URL"] ?? ""
        let secret = environment["LARIAT_CLOUD_BRIDGE_SECRET"] ?? ""
        return !baseUrl.isEmpty && !secret.isEmpty
    }
}
