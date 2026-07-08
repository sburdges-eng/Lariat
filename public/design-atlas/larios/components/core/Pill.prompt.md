**Pill** — a small uppercase status capsule tinted by tone. Use for line/stock status: Ready, Low, Out, 86'd.

```jsx
<Pill tone="ok" dot>Ready</Pill>
<Pill tone="warn">Low</Pill>
<Pill tone="alert" dot>86'd</Pill>
<Pill tone="lari">LaRi</Pill>
```

- Tones: `neutral`, `ok`, `warn`, `alert`, `amber`, `ink`, `lari` (the assistant chip).
- `dot` adds a leading status dot in the current tone color.
