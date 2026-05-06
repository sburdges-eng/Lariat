# Plan: Staff Performance Reviews (Worktree: feat/staff-performance-reviews)

**Date:** 2026-05-06
**Status:** PROPOSED (Ready for Claude Implementation)
**Scope:** Management / Labor Compliance
**Author:** Gemini CLI

## 1. Objective
Implement a lightweight, manager-only staff review system to record periodic evaluations for cooks. This closes the gap in performance tracking within the Lariat Cockpit, providing a structured way to log metrics like punctuality, technique, and speed.

## 2. Impact Analysis Summary
- **Critical Path:** `lib/db.ts` (`initSchema`) is the primary entry point. Syntax errors here will crash the app.
- **Reporting:** `scripts/export.mjs` must be updated to include the new table in compliance exports.
- **Audit:** Integration with `audit_events` is required for HR/Management tracking.
- **Consistency:** Following the `gold_stars` pattern using `cook_name` (TEXT) for flexibility.

## 3. Proposed Changes

### 3.1 Database Schema (`lib/db.ts`)
Add a new table `performance_reviews` and its associated TypeScript interface.

**Interface:**
```typescript
export interface PerformanceReview {
  id: number;
  cook_name: string;
  review_date: string;
  punctuality_score: number;
  technique_score: number;
  speed_score: number;
  notes: string | null;
  reviewer_name: string;
  location_id: string;
  created_at: string;
}
```

**SQL:**
```sql
CREATE TABLE IF NOT EXISTS performance_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cook_name TEXT NOT NULL,
  review_date TEXT NOT NULL,
  punctuality_score INTEGER,
  technique_score INTEGER,
  speed_score INTEGER,
  notes TEXT,
  reviewer_name TEXT NOT NULL,
  location_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_perf_review_cook ON performance_reviews(cook_name, location_id);
```

### 3.2 API Layer
Create endpoints for CRUD operations with transactional integrity and audit logging.
- `GET /api/performance-reviews`: List reviews by location.
- `POST /api/performance-reviews`: Create review (with `withIdempotency` and `postAuditEvent`).
- `DELETE /api/performance-reviews/[id]`: Remove review.

### 3.3 UI Integration
- **Management Dashboard (`app/management/page.jsx`)**: Add a rollup tile showing total review counts.
- **Labor Hub (`app/labor/page.jsx`)**: Add a Staff Reviews tile summarizing reviews logged today and total on record.
- **Command Center (`app/command/page.jsx` & `lib/commandCenter.ts`)**: Integrate review counts into the Labor tile, add an amber alert if no reviews are logged today, and add a "Reviews today" list section to the bottom of the dashboard.
- **Kitchen Assistant (`lib/kitchenAssistantContext.ts`)**: Ground the AI in recent performance reviews when staff-related keywords are detected.
- **Review Board (`app/management/performance-reviews/`)**: Dedicated management interface for evaluation logging with search and classification.
- **Standard Operating Procedure (`docs/SOP_STAFF_PERFORMANCE_REVIEWS.md`)**: Formalized scoring rubric and review cadence for managers.
- **Navigation (`app/_components/navRegistry.js`)**: Register for ⌘K palette access.

### 3.4 Exports (`scripts/export.mjs`)
Include `performance_reviews` in daily CSV/XLSX compliance reports.

## 4. Proposed Diffs

[See the detailed diffs provided in the hand-off prompt for Claude.]

## 5. Verification Plan
1. **Schema**: Run `npm run test:schema` to verify idempotent table creation.
2. **Pure Logic**: Execute `node --test tests/js/test-performance-reviews-rules.mjs` to verify classification and validation boundaries.
3. **API**: Execute the integration test suite `tests/js/test-performance-reviews-api.mjs`.
4. **Typecheck**: Run `npm run typecheck` to ensure interface consistency.
4. **MACP**: Run `node scripts/agent-session.mjs list` to verify no collisions.
