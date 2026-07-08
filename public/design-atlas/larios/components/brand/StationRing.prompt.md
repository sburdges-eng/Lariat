**StationRing** — the line-station progress ring from the cockpit rail. A hairline track with a tone-colored fill sweep and a centered station number.

```jsx
<StationRing done={4} total={6} glyph={1} />
<StationRing flagged={2} total={6} glyph={3} />
<StationRing signedOff total={6} glyph={2} />
```

- Tone derives from progress: flagged / not-started → `--fire`, in-progress → `--accent` (amber), done/signed-off → bone. Override with `tone`.
- `glyph` is usually the 1–6 station number; `size` controls diameter.
