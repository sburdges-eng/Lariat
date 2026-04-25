# Lariat Data Expansion Plan: Colorado Labor Law, Liquor Law, and Security Boundaries

## Status

This document defines the local data pack expansion for Colorado-specific workplace compliance, alcohol service rules, and security/bouncer qualification boundaries.

> Legal warning: this is a data architecture and source-planning document, not legal advice. Colorado statutes, regulations, local ordinances, and liquor enforcement guidance can change. Treat all legal data as versioned reference material requiring periodic verification.

---

## 1. Data Domains To Add

### 1.1 Colorado Labor Law

Purpose:
- Staff scheduling compliance
- wage/hour reference
- break/rest-period training
- minors/youth labor boundaries
- tip/wage handling references
- harassment/discrimination policy reference
- termination/write-up documentation support
- manager decision-support guardrails

Recommended source categories:
- Colorado Department of Labor and Employment (CDLE)
- Colorado Overtime and Minimum Pay Standards Order (COMPS Order)
- Colorado Wage Act references
- Colorado Healthy Families and Workplaces Act references
- Colorado anti-discrimination/employment guidance
- youth employment / minor labor rules
- federal Department of Labor references where Colorado defers to or exceeds federal baseline

Suggested local files:

```txt
data/raw/colorado_labor_law/
  cdle/
  comps_order/
  wage_act/
  paid_sick_leave/
  youth_labor/
  workplace_posters/
  federal_dol_baseline/
```

Normalized outputs:

```txt
data/normalized/colorado_labor_rules.jsonl
data/normalized/colorado_workplace_posters.jsonl
data/normalized/colorado_minor_labor_rules.jsonl
data/normalized/colorado_wage_hour_rules.jsonl
```

Core schema:

```json
{
  "id": "co_labor_rule_0001",
  "jurisdiction": "Colorado",
  "domain": "labor_law",
  "topic": "meal_breaks_rest_periods",
  "rule_summary": "Human-readable plain-language summary.",
  "applicability": ["restaurant", "hourly_employee", "non_exempt"],
  "requirements": [],
  "exceptions": [],
  "source_title": "UNKNOWN until downloaded",
  "source_url": "UNKNOWN until verified",
  "source_date": "UNKNOWN until verified",
  "effective_date": "UNKNOWN until verified",
  "last_verified": "UNKNOWN",
  "legal_confidence": "unverified"
}
```

---

## 2. Colorado Liquor Law / Alcohol Service

Purpose:
- bartender/server alcohol compliance training
- ID checking workflows
- overservice refusal scripts
- incident log templates
- liquor-license boundary reference
- manager escalation rules
- house policy generation
- dram shop/liability awareness references

Recommended source categories:
- Colorado Liquor Enforcement Division
- Colorado Department of Revenue alcohol rules
- Colorado Beer Code / Liquor Code references
- local licensing authority rules, if applicable
- responsible vendor/server training references
- age verification and refusal of service guidance

Suggested local files:

```txt
data/raw/colorado_liquor_law/
  liquor_enforcement_division/
  department_of_revenue/
  responsible_vendor_training/
  id_checking/
  refusal_of_service/
  incident_logs/
  local_authority/
```

Normalized outputs:

```txt
data/normalized/colorado_liquor_rules.jsonl
data/normalized/alcohol_service_training_rules.jsonl
data/normalized/id_checking_rules.jsonl
data/normalized/refusal_of_service_scripts.jsonl
data/normalized/alcohol_incident_log_fields.jsonl
```

Core schema:

```json
{
  "id": "co_liquor_rule_0001",
  "jurisdiction": "Colorado",
  "domain": "liquor_law",
  "topic": "id_checking",
  "rule_summary": "Plain-language operational rule.",
  "applies_to": ["server", "bartender", "manager", "door_security"],
  "required_actions": [],
  "prohibited_actions": [],
  "escalation_required": false,
  "documentation_required": false,
  "source_title": "UNKNOWN until downloaded",
  "source_url": "UNKNOWN until verified",
  "source_date": "UNKNOWN until verified",
  "effective_date": "UNKNOWN until verified",
  "last_verified": "UNKNOWN",
  "legal_confidence": "unverified"
}
```

---

## 3. Security Qualifications and Boundaries

Purpose:
- define what door/security staff may and may not do
- prevent staff from acting like law enforcement
- clarify de-escalation boundaries
- define incident documentation rules
- define when to call police/EMS/management
- define alcohol-related ejection boundaries
- support training quizzes and onboarding

Important distinction:
- Security/door staff rules may involve state law, local ordinances, employer policy, liquor-license expectations, premises liability, use-of-force law, and training/vendor certification standards.
- Exact Colorado requirements are UNKNOWN until verified against current official sources and local jurisdiction rules.

Suggested source categories:
- Colorado state statutes relevant to private security, assault, trespass, citizen detention, use of force, and disorderly conduct
- local city/county private security licensing rules, if applicable
- Colorado liquor enforcement guidance on intoxicated patrons and disorderly conduct
- OSHA/workplace violence prevention references
- employer-created house policy
- de-escalation training standards from reputable public sources

Suggested local files:

```txt
data/raw/security_boundaries/
  colorado_state_law/
  local_ordinances/
  liquor_related_security/
  deescalation_training/
  use_of_force_boundaries/
  incident_documentation/
  medical_emergency_response/
```

Normalized outputs:

```txt
data/normalized/security_role_boundaries.jsonl
data/normalized/security_escalation_rules.jsonl
data/normalized/security_incident_types.jsonl
data/normalized/security_training_requirements.jsonl
data/normalized/security_prohibited_actions.jsonl
```

Core schema:

```json
{
  "id": "security_boundary_0001",
  "jurisdiction": "Colorado",
  "local_jurisdiction": "UNKNOWN",
  "domain": "security_boundaries",
  "topic": "physical_contact",
  "role": "door_security",
  "allowed_actions": [],
  "restricted_actions": [],
  "prohibited_actions": [],
  "requires_manager": true,
  "requires_police": false,
  "requires_ems": false,
  "documentation_required": true,
  "training_required": "UNKNOWN until verified",
  "source_title": "UNKNOWN until verified",
  "source_url": "UNKNOWN until verified",
  "last_verified": "UNKNOWN",
  "legal_confidence": "unverified"
}
```

---

## 4. Proposed Unified Compliance Schema

Use a single compliance-rule layer so Lariat can query all legal/ops constraints consistently.

```json
{
  "id": "rule_id",
  "domain": "labor_law | liquor_law | security_boundaries | food_safety | internal_policy",
  "jurisdiction": "Colorado",
  "local_jurisdiction": "optional",
  "topic": "short_topic_key",
  "audience": ["owner", "manager", "cook", "server", "bartender", "door_security"],
  "plain_language_summary": "Short operational explanation.",
  "required_actions": [],
  "prohibited_actions": [],
  "allowed_actions": [],
  "exceptions": [],
  "escalation": {
    "manager_required": false,
    "police_required": false,
    "ems_required": false,
    "documentation_required": false
  },
  "source": {
    "title": "UNKNOWN",
    "publisher": "UNKNOWN",
    "url": "UNKNOWN",
    "effective_date": "UNKNOWN",
    "retrieved_date": "UNKNOWN"
  },
  "verification": {
    "status": "unverified | verified | stale | superseded",
    "last_verified": "UNKNOWN",
    "review_interval_days": 90
  },
  "notes": []
}
```

---

## 5. Recommended Lariat Data Tree Addition

```txt
data/
  raw/
    colorado_labor_law/
    colorado_liquor_law/
    security_boundaries/
  normalized/
    compliance_rules.jsonl
    colorado_labor_rules.jsonl
    colorado_liquor_rules.jsonl
    security_role_boundaries.jsonl
    security_escalation_rules.jsonl
  indexes/
    compliance_search/
    compliance_embeddings/
  manifests/
    compliance_sources.json
    compliance_download_log.json
    compliance_verification_log.json
```

---

## 6. Recommended Ingestion Steps

1. Download official source documents only.
2. Store raw PDFs/HTML/CSV unchanged.
3. Create a source manifest with URL, title, retrieved date, and file hash.
4. Extract plain text into staging files.
5. Normalize rules into JSONL.
6. Mark each rule as unverified until reviewed.
7. Generate plain-language training versions separately from source rules.
8. Add manager-facing warnings where rules are incomplete or jurisdiction-dependent.
9. Re-check legal/compliance sources every 90 days.

---

## 7. Priority Download Order

```txt
1. Colorado COMPS / wage-hour rules
2. Colorado required workplace posters
3. Colorado paid sick leave references
4. Colorado youth labor references
5. Colorado Liquor Enforcement Division rules/guides
6. Colorado responsible vendor/server guidance
7. ID checking and refusal-of-service guidance
8. Alcohol incident log templates
9. Local liquor licensing authority materials
10. Security role boundary references
11. Use-of-force / de-escalation references
12. Internal Lariat house policy overlay
```

---

## 8. Risk Controls

Rules that should always trigger caution in the UI:

```txt
- employee discipline / termination
- wage deduction
- tip pooling
- unpaid work
- breaks/rest periods
- minor employees
- intoxicated patron removal
- fake ID handling
- physical removal from premises
- use of force
- medical emergency
- law enforcement contact
- discrimination / harassment
```

For these topics, Lariat should display:

```txt
Verify current law and house policy before acting. Escalate to management, HR, legal counsel, law enforcement, or EMS where appropriate.
```

---

## 9. Estimated Storage Impact

```txt
Colorado labor law raw docs:       <1 GB
Colorado liquor law raw docs:      <1 GB
Security/legal boundary docs:      <1 GB
Normalized compliance JSONL:       <100 MB
Search indexes/embeddings:         1–5 GB

Recommended reserved space:        10 GB
```

This is tiny compared with food/product/recipe datasets. Legal PDFs do not eat storage like Open Food Facts images, mercifully.

---

## 10. Implementation Note

Do not merge legal rules directly into culinary recipe logic. Keep compliance data in a separate `compliance_rules` layer and let recipes, scheduling, training, and incident workflows query it as needed.

Recommended module boundary:

```txt
src/compliance/
  sources.py
  ingest.py
  normalize.py
  rules_engine.py
  search.py
  warnings.py
```

Recommended first issue title:

```txt
Add Colorado compliance data pipeline for labor, liquor, and security boundaries
```
