**Kpi** — a metric cell: mono uppercase label, big grotesque tabular value, optional trend sub-line.

```jsx
<Kpi label="Food cost" value="28.4%" sub="▼ 1.2 vs par" trend="up" />
<Kpi label="86'd" value={3} sub="tonight" trend="warn" />
```

- `trend`: `up` (sage), `down` (oxblood), `warn` (amber) — colors the sub-line only.
- Values are always tabular figures.
