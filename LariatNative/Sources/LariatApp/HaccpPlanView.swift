import SwiftUI
import LariatDB
import LariatModel
import Observation

// Native port of /food-safety/haccp-plan — the inspector-ready HACCP plan.
// READ-ONLY document: reads the plan aggregate via HaccpPlanRepository (no write
// path, no audit). Mirrors app/food-safety/haccp-plan/page.jsx section-for-section:
// CCP inventory, food-safety programs, corrective actions, calibrations + probe
// board, and a sign-off block.

// MARK: - ViewModel

@Observable @MainActor final class HaccpPlanViewModel {
    var plan: HaccpPlan?
    var errorText: String?
    private var loadTask: Task<Void, Never>?
    private let database: LariatDatabase

    init(database: LariatDatabase) {
        self.database = database
    }

    func load() {
        loadTask?.cancel()
        let repo = HaccpPlanRepository(database: database)
        let today = ShiftDate.todayISO()
        loadTask = Task { [weak self] in
            do {
                let p = try await repo.buildPlan(today: today)
                await MainActor.run {
                    self?.plan = p
                    self?.errorText = nil
                }
            } catch {
                await MainActor.run {
                    self?.errorText = "Could not build HACCP plan: \(error.localizedDescription)"
                }
            }
        }
    }

    func stop() { loadTask?.cancel() }
}

// MARK: - Root view

struct HaccpPlanView: View {
    @State private var vm: HaccpPlanViewModel
    init(database: LariatDatabase) { _vm = State(wrappedValue: HaccpPlanViewModel(database: database)) }

    var body: some View {
        Group {
            if let err = vm.errorText {
                TileDegrade(
                    title: "Database unavailable",
                    message: err,
                    systemImage: "externaldrive.badge.xmark"
                )
            } else if let plan = vm.plan {
                HaccpPlanDocumentView(plan: plan)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("HACCP plan")
        .task { vm.load() }
        .onDisappear { vm.stop() }
    }
}

// MARK: - Document

private struct HaccpPlanDocumentView: View {
    let plan: HaccpPlan

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                ccpSection
                programsSection
                correctiveSection
                calibrationSection
                signOffSection
            }
            .padding()
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // ── Header ──────────────────────────────────────────────────────────────

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("HACCP plan")
                .font(.largeTitle).bold()
            Text(
                "Location: \(plan.locationId) · Plan date: \(plan.planDate) · " +
                "Evidence window: \(plan.windowStart) to \(plan.planDate) (\(plan.windowDays) days) · " +
                "Generated: \(fmtTs(plan.generatedAt))"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    // ── Critical control points ─────────────────────────────────────────────

    private var ccpSection: some View {
        SectionCard(title: "Critical control points") {
            Text("Single-reading temperature CCPs monitored via the temp log. Counts are readings recorded in the evidence window.")
                .font(.caption)
                .foregroundStyle(.tertiary)

            VStack(spacing: 0) {
                CcpHeaderRow()
                ForEach(plan.ccps) { p in
                    CcpRow(
                        ccp: p.ccpId, point: p.label,
                        limit: limitText(p.requiredMinF, p.requiredMaxF),
                        citation: p.citation,
                        logs: "\(p.logs30d)", corrective: "\(p.corrective30d)"
                    )
                    Divider()
                }
                // Cooling (CCP-8) — time-based, summarized separately.
                CcpRow(
                    ccp: plan.cooling.ccpId, point: "Two-stage cooling",
                    limit: "time-based",
                    citation: plan.cooling.citation,
                    logs: "\(plan.cooling.batches30d) batches",
                    corrective: "\(plan.cooling.breaches30d) breaches"
                )
            }
        }
    }

    // ── Food-safety programs ────────────────────────────────────────────────

    private var programsSection: some View {
        SectionCard(title: "Food-safety programs") {
            VStack(spacing: 0) {
                ForEach(plan.ruleModules) { m in
                    HStack(alignment: .top, spacing: 12) {
                        Text(m.name)
                            .font(.subheadline).fontWeight(.semibold)
                            .frame(minWidth: 180, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.citation)
                                .font(.caption).foregroundStyle(.secondary)
                            Text("\(m.records) \(m.evidenceLabel)")
                                .font(.caption).foregroundStyle(m.active ? .primary : .tertiary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 6)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(m.name), \(m.citation), \(m.records) \(m.evidenceLabel)")
                    Divider()
                }
            }
        }
    }

    // ── Corrective actions ──────────────────────────────────────────────────

    private var correctiveSection: some View {
        SectionCard(title: "Corrective actions — last \(plan.windowDays) days") {
            Text(plan.correctiveActions.citation)
                .font(.caption).foregroundStyle(.tertiary)
            if plan.correctiveActions.count == 0 {
                Text("No corrective actions recorded in the window.")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(plan.correctiveActions.entries) { e in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(e.shiftDate).font(.caption).monospacedDigit()
                                Text(e.source == .tempLog ? "Temp log" : "Line check")
                                    .font(.caption2)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(.quaternary, in: Capsule())
                                Text(e.subject).font(.caption).fontWeight(.semibold)
                                Spacer()
                                Text(e.cookId ?? "—").font(.caption2).foregroundStyle(.secondary)
                            }
                            Text(e.note).font(.callout)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 6)
                        Divider()
                    }
                }
            }
        }
    }

    // ── Thermometer calibrations + probe board ──────────────────────────────

    private var calibrationSection: some View {
        SectionCard(title: "Thermometer calibrations — last \(plan.windowDays) days") {
            Text("\(plan.calibrations.citation) · Default frequency: \(plan.calibrations.frequencyDaysDefault) days")
                .font(.caption).foregroundStyle(.tertiary)

            if plan.calibrations.records.isEmpty {
                Text("No calibrations recorded in the window.")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(plan.calibrations.records) { r in
                        HStack(spacing: 12) {
                            Text(fmtTs(r.calibratedAt)).font(.caption).monospacedDigit()
                                .frame(width: 130, alignment: .leading)
                            Text(r.thermometerId).font(.caption).fontWeight(.semibold)
                                .frame(width: 90, alignment: .leading)
                            Text(r.method).font(.caption2).foregroundStyle(.secondary)
                                .frame(width: 90, alignment: .leading)
                            Text(r.beforeReadingF.map { "\(fmtF($0))°F" } ?? "—").font(.caption).monospacedDigit()
                            Text(r.passed ? "Pass" : "Fail")
                                .font(.caption2).bold()
                                .foregroundStyle(r.passed ? Color.green : Color.red)
                            Text(r.actionTaken ?? "—").font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            Text(r.cookId ?? "—").font(.caption2).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 5)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(r.thermometerId), calibrated \(fmtTs(r.calibratedAt)), \(r.method), \(r.passed ? "pass" : "fail")")
                        Divider()
                    }
                }
            }

            if !plan.calibrations.probes.isEmpty {
                Text("Probe status as of \(plan.planDate)")
                    .font(.subheadline).fontWeight(.semibold)
                    .padding(.top, 8)
                VStack(spacing: 0) {
                    ForEach(plan.calibrations.probes) { p in
                        HStack(spacing: 12) {
                            Text(p.thermometerId).font(.caption).fontWeight(.semibold)
                                .frame(width: 110, alignment: .leading)
                            Text(p.status.rawValue)
                                .font(.caption2).bold()
                                .foregroundStyle(probeColor(p.status))
                                .frame(width: 90, alignment: .leading)
                            Text("Last: \(fmtTs(p.lastCalibratedAt))").font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            Text("Next due: \(fmtTs(p.nextDueAt))").font(.caption2).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 5)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(p.thermometerId), \(p.status.rawValue), last calibrated \(fmtTs(p.lastCalibratedAt)), next due \(fmtTs(p.nextDueAt))")
                        Divider()
                    }
                }
            }
        }
    }

    private func probeColor(_ status: HaccpProbeStatus) -> Color {
        switch status {
        case .ok: return .green
        case .dueSoon: return .orange
        case .overdue, .failed: return .red
        case .unknown: return .secondary
        }
    }

    // ── Sign-off ────────────────────────────────────────────────────────────

    private var signOffSection: some View {
        SectionCard(title: "Sign-off") {
            HStack(spacing: 32) {
                SigLine(label: "Person in charge — signature / date")
                SigLine(label: "Reviewed by — signature / date")
            }
        }
    }
}

// MARK: - Small components

private struct SectionCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.title3).bold()
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct CcpHeaderRow: View {
    var body: some View {
        HStack(spacing: 8) {
            cell("CCP", 70)
            cell("Point", 130)
            cell("Critical limit", 110)
            cell("Citation", nil)
            cell("Logs (30d)", 90)
            cell("Corr. (30d)", 90)
        }
        .font(.caption2).textCase(.uppercase).foregroundStyle(.secondary)
        .padding(.vertical, 4)
        Divider()
    }

    private func cell(_ text: String, _ width: CGFloat?) -> some View {
        Group {
            if let width { Text(text).frame(width: width, alignment: .leading) }
            else { Text(text).frame(maxWidth: .infinity, alignment: .leading) }
        }
    }
}

private struct CcpRow: View {
    let ccp: String, point: String, limit: String, citation: String, logs: String, corrective: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(ccp).font(.caption).monospacedDigit().frame(minWidth: 70, alignment: .leading)
            Text(point).font(.caption).frame(minWidth: 130, alignment: .leading)
            Text(limit).font(.caption).monospacedDigit().frame(minWidth: 110, alignment: .leading)
            Text(citation).font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            Text(logs).font(.caption).monospacedDigit().frame(minWidth: 90, alignment: .leading)
            Text(corrective).font(.caption).monospacedDigit().frame(minWidth: 90, alignment: .leading)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(ccp), \(point), critical limit \(limit), \(citation), \(logs) logs, \(corrective) corrective actions")
    }
}

private struct SigLine: View {
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Rectangle().frame(height: 1).foregroundStyle(.secondary)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 20)
    }
}

// MARK: - Formatting helpers (mirror page.jsx limitText / fmtTs)

/// `limitText(min, max)` — "70–41°F", "≥ 165°F", "≤ 41°F", or "—".
private func limitText(_ min: Double?, _ max: Double?) -> String {
    if let min, let max { return "\(fmtF(min))–\(fmtF(max))°F" }
    if let min { return "≥ \(fmtF(min))°F" }
    if let max { return "≤ \(fmtF(max))°F" }
    return "—"
}

/// Trim a whole-number Double to an int string (41 not 41.0).
private func fmtF(_ v: Double) -> String {
    if v == v.rounded() { return String(Int(v)) }
    return String(v)
}

/// `fmtTs(ts)` — "2026-07-05 08:00" (replace 'T', slice 16), "—" when nil/empty.
private func fmtTs(_ ts: String?) -> String {
    guard let ts, !ts.isEmpty else { return "—" }
    let replaced = ts.replacingOccurrences(of: "T", with: " ")
    return String(replaced.prefix(16))
}
