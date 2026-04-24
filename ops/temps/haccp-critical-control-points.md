# HACCP — Critical Control Points

The eight CCPs in active use at Lariat. Monitoring frequencies align with the
[README.md](README.md) table.

> Source: `food_safety/haccp_checklist_template.csv`
> Audit-binder CSV: [../templates/haccp-checklist.csv](../templates/haccp-checklist.csv)

---

## CCP-1 — Receiving (cold deliveries)

- **Hazard:** Biological (pathogen growth)
- **Critical limit:** Cold items ≤ 41°F on arrival
- **Monitoring:** Temp-check every delivery with probe thermometer
- **Corrective action:** Reject and return items above 41°F

## CCP-2 — Cold storage (walk-in cooler)

- **Hazard:** Biological (pathogen growth)
- **Critical limit:** Walk-in ≤ 41°F
- **Monitoring:** Check + log temp 2×/day (open + close)
- **Corrective action:** Adjust thermostat / move product / discard if >4 hrs above 41°F

## CCP-3 — Cold storage (freezer)

- **Hazard:** Biological (pathogen growth)
- **Critical limit:** Freezer ≤ 0°F
- **Monitoring:** Check + log temp 2×/day
- **Corrective action:** Adjust thermostat / move product / discard if thawed

## CCP-4 — Cooking — poultry

- **Hazard:** Biological (Salmonella)
- **Critical limit:** Internal temp ≥ 165°F for 15 sec
- **Monitoring:** Probe thermometer every batch
- **Corrective action:** Continue cooking until 165°F reached

## CCP-5 — Cooking — ground / whole beef, pork

See `food_safety/haccp_checklist_template.csv` for the full row — limits vary
by cut (ground 155°F, whole cuts 145°F for 15 sec).

## CCP-6 — Hot holding

- **Hazard:** Biological (pathogen growth)
- **Critical limit:** Hot items ≥ 135°F
- **Monitoring:** Every 2 hrs during service
- **Corrective action:** Reheat to 165°F within 2 hrs or discard

## CCP-7 — Cooling

- **Hazard:** Biological (pathogen growth in temperature danger zone)
- **Critical limit:** 135°F → 70°F in ≤ 2 hrs, 70°F → 41°F in ≤ 4 hrs total
- **Monitoring:** Logged in `/food-safety/cooling`
- **Corrective action:** Discard product that exceeds time/temp

## CCP-8 — Sanitizer concentration

- **Hazard:** Biological (cross-contamination, ineffective sanitization)
- **Critical limit:** Per sanitizer type (quat 200–400 ppm, chlorine 50–100 ppm)
- **Monitoring:** Test strips every 2 hrs
- **Corrective action:** Remix bucket, re-test

---

## Related

- Corrective action workflow: [corrective-actions.md](corrective-actions.md)
- Live logger: `/food-safety`
- Full CSV: [../templates/haccp-checklist.csv](../templates/haccp-checklist.csv)
