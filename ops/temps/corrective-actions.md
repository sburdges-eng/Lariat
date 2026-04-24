# Corrective Actions — When a Temp is Out of Range

A corrective action is the **written, signed record** of what you did when a
critical limit was exceeded. It's how we stay in business after a health dept.
walk-in.

> Live: `/food-safety/temp-log` → Flag any reading → Corrective Action form
> Master CSV: `food_safety/corrective_actions.csv`
> Template copy: [../templates/corrective-actions.csv](../templates/corrective-actions.csv)

---

## The four questions

Every corrective action answers:

1. **What was out of range?** (CCP ID, equipment, reading)
2. **What did you do with the product?** (reheat / cook more / discard / move)
3. **What did you do with the equipment?** (adjust / service ticket / swap)
4. **Who verified + signed?** (manager signature required)

---

## Decision tree

```
Temp reading flagged ──► is it a cooler?
        │
        ├── YES → is it > 41°F?
        │        ├── < 4 hrs since last good reading → move product to backup cooler, adjust, re-check in 1 hr
        │        └── ≥ 4 hrs → DISCARD TCS product, service ticket on unit
        │
        └── NO, it's a hot well / hot hold → is it < 135°F?
                 ├── < 2 hrs since last good reading → reheat to 165°F, re-hold
                 └── ≥ 2 hrs → DISCARD product
```

---

## CSV columns (what gets recorded)

```
date, time, reported_by, ccp_id, description, temp_reading_f,
corrective_action_taken, product_disposition, manager_signature,
follow_up_needed, follow_up_completed
```

See [../templates/corrective-actions.csv](../templates/corrective-actions.csv)
for the blank form.

---

## When to escalate

- **Any** discard of TCS product → text KM + Ops owner immediately
- **Second out-of-range** reading on the same unit in 48 hrs → file a service
  ticket (`/equipment` → Service)
- **Any illness-related event** → follow the `/food-safety/sick-worker` Big 6 protocol — different workflow, don't confuse the two
