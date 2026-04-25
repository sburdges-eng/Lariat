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
- Commonly accepted bar/venue practices are operational references only. They do not create legal permission to detain, search, use force, or seize property.

Suggested source categories:
- Colorado state statutes relevant to private security, assault, trespass, citizen detention, use of force, and disorderly conduct
- local city/county private security licensing rules, if applicable
- Colorado liquor enforcement guidance on intoxicated patrons and disorderly conduct
- OSHA/workplace violence prevention references
- employer-created house policy
- de-escalation training standards from reputable public sources
- venue security training manuals and incident documentation standards, where legally usable

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
  common_bouncer_practices/
  security_equipment/
  radio_protocols/
  flashlight_visual_cues/
  staffing_ratios/
```

Normalized outputs:

```txt
data/normalized/security_role_boundaries.jsonl
data/normalized/security_escalation_rules.jsonl
data/normalized/security_incident_types.jsonl
data/normalized/security_training_requirements.jsonl
data/normalized/security_prohibited_actions.jsonl
data/normalized/security_common_practices.jsonl
data/normalized/security_equipment.jsonl
data/normalized/security_radio_protocols.jsonl
data/normalized/security_visual_signal_protocols.jsonl
data/normalized/security_staffing_ratios.jsonl
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

## 3.1 Common Bouncer / Door Security Practices Dataset

Purpose:
- capture common bar/venue security practices as internal training data
- standardize communication between door, bar, floor, manager, and kitchen
- identify unsafe escalation patterns before staff improvise like liability is a hobby
- support scenario training and incident logging

Rule distinction:
- `common_practice` means widely used operational pattern.
- `house_policy` means approved by management for this venue.
- `legal_rule` means verified against official legal source.
- Lariat must not treat `common_practice` as legal authorization.

Suggested normalized file:

```txt
data/normalized/security_common_practices.jsonl
```

Core schema:

```json
{
  "id": "security_practice_0001",
  "domain": "security_operations",
  "category": "observation | communication | deescalation | positioning | removal | documentation",
  "practice_name": "Visible floor presence",
  "plain_language_summary": "Maintain visible, calm presence near the entry or problem area without crowding guests.",
  "intended_use": ["deterrence", "early_attention", "staff_reassurance"],
  "allowed_when": [],
  "not_allowed_when": [],
  "requires_manager": false,
  "requires_second_staff_member": false,
  "requires_documentation": false,
  "risk_level": "low | medium | high",
  "legal_status": "common_practice_not_legal_authority",
  "house_policy_status": "draft | approved | prohibited",
  "training_notes": [],
  "source": {
    "title": "Internal Lariat practice or external training source",
    "url": "UNKNOWN if internal",
    "last_verified": "UNKNOWN"
  }
}
```

Common practice categories to seed:

```txt
- visible floor presence
- calm verbal contact
- non-confrontational stance
- keeping hands visible
- maintaining exit path
- avoiding cornering patrons
- manager handoff
- bartender/server alerting
- door-to-floor communication
- radio check-ins
- flashlight visual attention cues
- UV/blacklight ID verification support
- incident witness identification
- post-incident log completion
- EMS/police escalation
```

---

## 3.2 Security Equipment Dataset

Purpose:
- define approved, restricted, and prohibited security equipment
- separate observation tools from force tools
- prevent staff from carrying random gear because someone watched one nightclub video online

Suggested normalized file:

```txt
data/normalized/security_equipment.jsonl
```

Core schema:

```json
{
  "id": "security_equipment_0001",
  "item_name": "Flashlight",
  "category": "visibility | communication | id_checking | documentation | protective | prohibited",
  "approved_use": ["low-light visibility", "visual attention cue", "safe path illumination"],
  "restricted_use": ["do not shine directly into eyes except brief emergency safety need"],
  "prohibited_use": ["intimidation", "striking", "harassment"],
  "required_training": "house_policy_training",
  "requires_manager_approval": false,
  "requires_legal_review": false,
  "documentation_required_after_use": false,
  "risk_level": "low",
  "house_policy_status": "draft"
}
```

Equipment seed list:

```txt
Generally appropriate / low-risk:
- standard flashlight
- UV / blacklight flashlight for ID checks
- two-way radio or approved communication app/device
- earpiece for radio, if used
- incident notebook or digital incident form
- click counter for occupancy, if applicable
- gloves for cleanup/first-aid boundaries, not for fighting
- high-visibility marker/vest only if venue wants clear staff identification

Needs management/legal review before approval:
- body camera
- metal detector wand
- bag-check table or bag-check signage
- hand stamps / wristbands tied to age verification
- restraints of any kind
- pepper spray / mace
- batons
- tactical gloves
- weapons or weapon-like tools

Default prohibited unless legal counsel and ownership approve:
- firearms
- knives
- expandable batons
- tasers/stun guns
- handcuffs/restraints
- improvised weapons
```

---

## 3.3 Flashlight / Visual Cue Protocols

Purpose:
- provide silent nonverbal staff alerts in loud environments
- call attention to uncondoned behavior without immediate confrontation
- reduce yelling, crowding, and public escalation

Suggested normalized file:

```txt
data/normalized/security_visual_signal_protocols.jsonl
```

Important safety rule:
- Flashlight cues should be aimed at surfaces, floor areas, walls, or staff sight lines. Do not intentionally shine lights into patron eyes as a warning or punishment.

Core schema:

```json
{
  "id": "visual_signal_0001",
  "signal_name": "Attention cue",
  "tool": "flashlight",
  "pattern": "brief downward flash toward floor near issue area",
  "meaning": "staff attention requested at location",
  "used_by": ["door_security", "floor_security", "manager"],
  "received_by": ["manager", "bar", "floor_staff"],
  "severity": "low | medium | high",
  "followup_action": "observe_and_check_in",
  "prohibited_usage": ["shining into eyes", "mocking patrons", "public intimidation"],
  "requires_documentation": false,
  "house_policy_status": "draft"
}
```

Suggested visual signals for house review:

```txt
LOW PRIORITY:
- one brief downward flash: staff attention requested
- steady low beam toward floor/path: safe path or spill/obstacle indicator

MEDIUM PRIORITY:
- two brief downward flashes: manager/floor support requested
- slow sweep across floor area, not patrons: observe this area

HIGH PRIORITY:
- repeated downward flashes away from faces: urgent support needed
- flashlight plus radio call: immediate manager/security response

NEVER USE:
- direct beam into patron eyes as discipline
- flashing to shame a guest
- flashlight used like a weapon or threat
```

---

## 3.4 Radio Call Protocols

Purpose:
- standardize short, calm, non-inflammatory radio communication
- avoid broadcasting accusations
- reduce panic and rumor spread
- document escalation chain

Suggested normalized file:

```txt
data/normalized/security_radio_protocols.jsonl
```

Core schema:

```json
{
  "id": "radio_protocol_0001",
  "call_name": "Manager check",
  "phrase": "Manager to front, please.",
  "meaning": "Manager requested without announcing conflict details.",
  "severity": "low | medium | high",
  "use_when": ["guest concern", "possible refusal", "staff needs support"],
  "avoid_phrases": ["drunk", "crazy", "fight", "fake ID"],
  "followup_required": "manager_assessment",
  "documentation_required": false,
  "house_policy_status": "draft"
}
```

Suggested radio phrase set:

```txt
Neutral support calls:
- "Manager to front, please."
- "Can I get a floor check near [location]?"
- "Door needs a second set of eyes."
- "Bar check, please."
- "Guest assistance at [location]."

ID / entry calls:
- "ID check support at door."
- "Second review needed."
- "Hold entry for manager."

Alcohol service calls:
- "Manager review for service."
- "Water and food support at [location]."
- "Safe ride check."

Escalation calls:
- "Security support to [location]."
- "Manager and second staff to [location]."
- "Clear path to exit."
- "Call EMS."
- "Call law enforcement."

Avoid on radio:
- insults
- medical guesses
- criminal accusations unless required for emergency response
- patron names unless needed
- jokes during incidents
```

---

## 3.5 Staffing Ratios / Extra Bouncer Guidance

Purpose:
- define response staffing expectations for disorderly patrons
- reduce one-on-one confrontations
- reduce excessive force risk
- create manager escalation thresholds

Suggested normalized file:

```txt
data/normalized/security_staffing_ratios.jsonl
```

Important rule:
- More staff should mean more witnesses, more de-escalation options, and safer exits. It must not mean a pile-on, intimidation ring, or group confrontation. Because apparently that needs saying.

Core schema:

```json
{
  "id": "staffing_ratio_0001",
  "scenario": "unruly_patron_verbal_only",
  "minimum_staff": 2,
  "recommended_staff": 2,
  "ratio_rule": "+1 trained staff member per unruly patron when escalation risk is present",
  "manager_required": true,
  "police_required": false,
  "ems_required": false,
  "goal": "witnessed de-escalation and safe exit path",
  "prohibited_pattern": "crowding, surrounding, taunting, or physically forcing without immediate safety need",
  "documentation_required": true,
  "house_policy_status": "draft"
}
```

Seed staffing rules:

```txt
- 1 upset verbal patron: manager + 1 trained support staff preferred
- 1 visibly intoxicated/unsteady patron: manager + 1 support staff; offer water/ride support where appropriate
- 1 aggressive patron: manager + at least 1 trained support staff; maintain distance and exit path
- 2 unruly patrons together: manager + 2 trained support staff if available
- group disturbance: manager leads; call law enforcement early if safety risk rises
- medical impairment suspected: EMS evaluation preferred over forceful removal
- weapon suspected: disengage, create distance, call law enforcement
- active fight: staff safety first; call law enforcement/EMS as needed; intervene only within training and immediate safety limits
```

---

## 3.6 Uncondoned Behavior Classification

Purpose:
- define behavior that triggers monitoring, warning, refusal, removal, documentation, or emergency response
- avoid subjective or discriminatory enforcement

Suggested normalized file:

```txt
data/normalized/security_behavior_triggers.jsonl
```

Core schema:

```json
{
  "id": "behavior_trigger_0001",
  "behavior": "harassing other guests",
  "severity": "medium",
  "initial_action": "manager_or_security_observation",
  "next_action": "verbal_boundary_or_service_refusal_review",
  "documentation_required": true,
  "protected_class_caution": true,
  "notes": "Enforce based on behavior, not appearance, identity, disability, race, gender, sexuality, or perceived social status. Revolutionary stuff, somehow."
}
```

Seed behavior triggers:

```txt
LOW:
- blocking walkway
- repeated loud disruption
- ignoring staff direction
- unsafe glassware handling
- entering restricted staff areas

MEDIUM:
- harassing guests or staff
- suspected fake ID requiring manager review
- visible intoxication requiring service review
- repeated unwanted contact with guests
- aggressive verbal behavior
- refusing to leave after service refusal

HIGH:
- threats
- pushing/shoving
- active fight
- property damage
- suspected weapon
- medical distress
- unconsciousness or severe impairment
- sexual harassment/assault allegation
```

---

## 4. Proposed Unified Compliance Schema

Use a single compliance-rule layer so Lariat can query all legal/ops constraints consistently.

```json
{
  "id": "rule_id",
  "domain": "labor_law | liquor_law | security_boundaries | food_safety | internal_policy | security_operations",
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
    "status": "unverified | verified | stale | superseded | internal_house_policy_draft",
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
    security_common_practices.jsonl
    security_equipment.jsonl
    security_radio_protocols.jsonl
    security_visual_signal_protocols.jsonl
    security_staffing_ratios.jsonl
    security_behavior_triggers.jsonl
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

1. Download official source documents only for legal/compliance rules.
2. Store raw PDFs/HTML/CSV unchanged.
3. Create a source manifest with URL, title, retrieved date, and file hash.
4. Extract plain text into staging files.
5. Normalize rules into JSONL.
6. Mark each legal rule as unverified until reviewed.
7. Generate plain-language training versions separately from source rules.
8. Add manager-facing warnings where rules are incomplete or jurisdiction-dependent.
9. Re-check legal/compliance sources every 90 days.
10. Store common bouncer practices separately as `security_operations` or `internal_policy`, not as `legal_rule`.
11. Require manager/ownership approval before any practice becomes active house policy.

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
13. Common bouncer practices seed dataset
14. Security equipment approval dataset
15. Radio protocol dataset
16. Flashlight/visual cue protocol dataset
17. Staffing ratio guidance dataset
18. Behavior trigger classification dataset
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
- ID confiscation
- patron search or bag check
- physical restraint
- use of flashlight or equipment in a threatening way
- security staff acting like police
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
Common bouncer practice docs:      <500 MB
Normalized compliance JSONL:       <250 MB
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

src/security_ops/
  equipment.py
  radio_protocols.py
  visual_signals.py
  staffing.py
  behavior_triggers.py
  incident_logs.py
```

Recommended first issue title:

```txt
Add Colorado compliance data pipeline for labor, liquor, security boundaries, and security operations
```
